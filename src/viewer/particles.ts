import * as THREE from 'three';
import { Blend } from '../formats/m2';
import { EMITTER_SPHERE, type LifeKeys, type ParticleEmitter } from '../formats/m2Particles';

/** Emitters further than this (yards) from the camera don't run. */
export const PARTICLE_RANGE = 160;
/** The same while a screenshot is prepared. */
export const SHOT_PARTICLE_RANGE = 1000;
/** Most particles alive per texture group, so a crowd of braziers can't swamp a frame. */
const MAX_PER_GROUP = 3000;
/** Longest simulation step (s); a stalled frame shouldn't fling particles. */
const MAX_STEP = 0.1;

/** An emitter together with its (loaded) texture. */
export interface LoadedEmitter {
	def: ParticleEmitter;
	texture: THREE.Texture;
}

/** A placed model's emitters this frame: its instance key and world matrix. */
export interface EmitterSource {
	key: string;
	matrix: THREE.Matrix4;
	emitters: LoadedEmitter[];
	/** The emitters' world frames this frame, for a model that moves its emitters about (instead of matrix with their own). */
	frames?: THREE.Matrix4[];
}

interface Particle {
	x: number; y: number; z: number;
	vx: number; vy: number; vz: number;
	age: number;
	life: number;
	/** Instance scale times the particle's own size variation. */
	size: number;
	/** Yards per second squared, pulling toward world down. */
	gravity: number;
	angle: number;
	spin: number;
	cell: number;
	def: ParticleEmitter;
	/** For an emitter that moves its particles with it: how it moved this frame. */
	anchor?: { delta: THREE.Matrix4 };
}

/** Per placed emitter: world frames, and the fractional particle carried to the next frame. */
interface EmitterState {
	frames: THREE.Matrix4[];
	/** World frames over the loop, for emitters on moving bones. */
	motion: (THREE.Matrix4[] | null)[];
	/** Where in the loop this copy is, 0-1, so neighbours don't turn in step. */
	phase: number;
	scales: number[];
	carry: number[];
	/** How each emitter moved this frame, when its particles move with it. */
	anchors: { delta: THREE.Matrix4 }[] | null;
	seen: number;
}

/** Particles sharing a texture, blend and flipbook grid: drawn as one instanced mesh of quads. */
interface Group {
	mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
	offset: THREE.InstancedBufferAttribute;
	color: THREE.InstancedBufferAttribute;
	shape: THREE.InstancedBufferAttribute;
	particles: Particle[];
	seen: number;
}

const VERTEX = /* glsl */ `
attribute vec3 offset;
attribute vec4 color;
/** Half size, rotation, flipbook cell. */
attribute vec3 shape;
uniform vec2 uGrid;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
	vec4 mvPosition = viewMatrix * vec4(offset, 1.0);
	float c = cos(shape.y), s = sin(shape.y);
	vec2 corner = position.xy;
	mvPosition.xy += mat2(c, s, -s, c) * corner * shape.x;
	gl_Position = projectionMatrix * mvPosition;
	float col = mod(shape.z, uGrid.x);
	float row = floor(shape.z / uGrid.x);
	// Row 0 is the top of the texture, as for model UVs.
	vUv = (vec2(col, row) + vec2(0.5 + 0.5 * corner.x, 0.5 - 0.5 * corner.y)) / uGrid;
	// Key colours are sRGB; lighting maths here is linear.
	vColor = vec4(pow(color.rgb, vec3(2.2)), color.a);
	#include <logdepthbuf_vertex>
	#include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float uAlphaTest;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	vec4 c = texture2D(map, vUv) * vColor;
	if (c.a <= uAlphaTest) discard;
	gl_FragColor = c;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#ifdef USE_FOG
		float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
		#ifdef ADDITIVE
			// Glow fades out into the fog rather than turning fog-coloured.
			gl_FragColor.rgb *= 1.0 - fogFactor;
		#else
			gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
		#endif
	#endif
}`;

const additive = (blend: number) => blend === Blend.Add || blend === Blend.NoAlphaAdd || blend === Blend.BlendAdd;

/** A keyed value at t (0-1 of the life), one component. */
function lifeValue(keys: LifeKeys, t: number, stride: number, component: number, fallback: number): number {
	const n = keys.times.length;
	if (!n) return fallback;
	const at = (k: number) => keys.values[k * stride + component];
	if (t <= keys.times[0]) return at(0);
	for (let k = 0; k < n - 1; k++) {
		const t1 = keys.times[k + 1];
		if (t < t1) {
			const t0 = keys.times[k];
			return at(k) + (at(k + 1) - at(k)) * (t1 > t0 ? (t - t0) / (t1 - t0) : 0);
		}
	}
	return at(n - 1);
}

function createMaterial(blend: number, cols: number, rows: number): THREE.ShaderMaterial {
	const add = additive(blend);
	return new THREE.ShaderMaterial({
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
			map: { value: null },
			uGrid: { value: new THREE.Vector2(cols, rows) },
			uAlphaTest: { value: blend === Blend.AlphaKey || blend === Blend.Opaque ? 0.5 : 0.004 },
		}]),
		defines: add ? { ADDITIVE: '' } : {},
		transparent: true,
		depthWrite: false,
		blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
		fog: true,
	});
}

/** A particle's quad, corners in its own space. */
const QUAD = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];

const rand = (spread: number) => (Math.random() * 2 - 1) * spread;

/**
 * M2 particles (torch and brazier flames, smoke, sparks) around the camera, simulated on the CPU
 * in world space from each placed model's emitters and drawn as camera-facing quads.
 */
export class ParticleSystem {
	readonly group = new THREE.Group();
	private readonly states = new Map<string, EmitterState>();
	private readonly groups = new Map<string, Group>();
	private frame = 0;
	/** Seconds simulated, for emitters that move with their bone's loop. */
	private time = 0;
	private readonly warmMaterials: THREE.ShaderMaterial[] = [];

	/**
	 * Compiles both particle shaders (glowing and see-through) ahead of time, so the first fire
	 * that comes into view doesn't stall a frame on shader compilation.
	 */
	warmUp(prepare: (object: THREE.Object3D) => Promise<void>): void {
		for (const blend of [Blend.Add, Blend.Alpha]) {
			// The material is kept: disposing it would release its program, and the first
			// particles would compile it all over again.
			// With the quad's corners: whether there's a position attribute is part of the shader too.
			const geometry = new THREE.InstancedBufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(QUAD, 3));
			this.warmMaterials.push(createMaterial(blend, 1, 1));
			void prepare(new THREE.Mesh(geometry, this.warmMaterials.at(-1)!)).finally(() => geometry.dispose());
		}
	}

	get count(): number {
		let n = 0;
		for (const g of this.groups.values()) n += g.particles.length;
		return n;
	}

	update(dt: number, sources: EmitterSource[]): void {
		dt = Math.min(dt, MAX_STEP);
		const frame = ++this.frame;
		this.time += dt;
		for (const source of sources) {
			let state = this.states.get(source.key);
			if (!state) {
				state = this.createState(source);
				this.states.set(source.key, state);
			}
			state.seen = frame;
			if (source.frames) this.follow(state, source.frames);
			source.emitters.forEach((e, i) => this.emit(e, state!, i, dt, frame));
		}
		for (const [key, state] of this.states) if (state.seen !== frame) this.states.delete(key);

		for (const [key, g] of this.groups) {
			this.simulate(g, dt);
			// Groups whose emitters have all gone away are dropped once their last particle dies.
			if (!g.particles.length && g.seen !== frame) {
				this.group.remove(g.mesh);
				g.mesh.geometry.dispose();
				g.mesh.material.dispose();
				this.groups.delete(key);
			}
		}
	}

	/**
	 * Moves an emitter to its new frames, carrying its live particles along (a torch's flame stays
	 * on the torch as its bearer runs, instead of trailing behind in the world).
	 */
	private follow(state: EmitterState, frames: THREE.Matrix4[]): void {
		const anchors = state.anchors!;
		frames.forEach((now, i) => anchors[i].delta.copy(now).multiply(new THREE.Matrix4().copy(state.frames[i]).invert()));
		state.frames = frames;
		const e = new THREE.Vector3();
		for (const g of this.groups.values()) {
			for (const p of g.particles) {
				const m = p.anchor?.delta;
				if (!m || !anchors.includes(p.anchor!)) continue;
				e.set(p.x, p.y, p.z).applyMatrix4(m);
				p.x = e.x; p.y = e.y; p.z = e.z;
				e.set(p.vx, p.vy, p.vz).transformDirection(m).multiplyScalar(Math.hypot(p.vx, p.vy, p.vz));
				p.vx = e.x; p.vy = e.y; p.vz = e.z;
			}
		}
	}

	private createState(source: EmitterSource): EmitterState {
		const place = (frame: ArrayLike<number>) => source.matrix.clone().multiply(new THREE.Matrix4().fromArray(frame));
		const frames = source.emitters.map((e) => place(e.def.frame));
		return {
			frames,
			motion: source.emitters.map((e) => (source.frames ? null : e.def.motion?.frames.map(place) ?? null)),
			phase: Math.random(),
			scales: frames.map((m) => new THREE.Vector3().setFromMatrixColumn(m, 0).length()),
			// Start part-way, so emitters that come into range together don't pulse together.
			carry: source.emitters.map(() => Math.random()),
			anchors: source.frames ? source.emitters.map(() => ({ delta: new THREE.Matrix4() })) : null,
			seen: 0,
		};
	}

	private groupFor(e: LoadedEmitter, frame: number): Group {
		const key = `${e.texture.id}:${e.def.blend}:${e.def.cols}x${e.def.rows}`;
		let g = this.groups.get(key);
		if (!g) {
			// Each group owns its quad: disposing a geometry frees its buffers on the GPU, which
			// would break any other group sharing them.
			const geometry = new THREE.InstancedBufferGeometry();
			geometry.setIndex([0, 1, 2, 0, 2, 3]);
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(QUAD, 3));
			const attribute = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_GROUP * size), size).setUsage(THREE.DynamicDrawUsage);
			const offset = attribute(3), color = attribute(4), shape = attribute(3);
			geometry.setAttribute('offset', offset);
			geometry.setAttribute('color', color);
			geometry.setAttribute('shape', shape);
			geometry.instanceCount = 0;
			const material = createMaterial(e.def.blend, e.def.cols, e.def.rows);
			material.uniforms.map.value = e.texture;
			const mesh = new THREE.Mesh(geometry, material);
			mesh.frustumCulled = false;
			// After the scene's other see-through things (water), which is mostly right for fire.
			mesh.renderOrder = 2;
			this.group.add(mesh);
			g = { mesh, offset, color, shape, particles: [], seen: frame };
			this.groups.set(key, g);
		}
		g.seen = frame;
		return g;
	}

	private emit(e: LoadedEmitter, state: EmitterState, i: number, dt: number, frame: number): void {
		const def = e.def;
		const g = this.groupFor(e, frame);
		state.carry[i] += def.rate * dt;
		const motion = state.motion[i];
		const loop = def.motion?.duration ?? 1;
		const m = (motion ? motion[Math.floor((((this.time / loop + state.phase) % 1) * motion.length)) % motion.length] : state.frames[i]).elements;
		const scale = state.scales[i];
		const cells = def.rows * def.cols;
		while (state.carry[i] >= 1) {
			state.carry[i] -= 1;
			if (g.particles.length >= MAX_PER_GROUP) continue;
			// Direction: within the emitter's vertical cone, any way round horizontally. Azimuth
			// counts from y: a sphere with no horizontal range is a ring across the model's x axis
			// (instance portals spin it about x to swirl, and loop with a jump only that hides).
			const polar = rand(def.verticalRange);
			const azimuth = rand(def.horizontalRange);
			let dx = Math.sin(polar) * Math.sin(azimuth), dy = Math.sin(polar) * Math.cos(azimuth), dz = Math.cos(polar);
			let px: number, py: number, pz: number;
			if (def.type === EMITTER_SPHERE) {
				const radius = def.areaLength + Math.random() * (def.areaWidth - def.areaLength);
				px = dx * radius; py = dy * radius; pz = dz * radius;
			} else {
				px = rand(def.areaLength / 2); py = rand(def.areaWidth / 2); pz = 0;
				if (def.zSource > 0) {
					// Spread out from a point below the emitter.
					const len = Math.hypot(px, py, pz + def.zSource) || 1;
					dx = px / len; dy = py / len; dz = (pz + def.zSource) / len;
				}
			}
			const speed = def.speed * (1 + rand(def.speedVary));
			const vx = dx * speed, vy = dy * speed, vz = dz * speed;
			g.particles.push({
				x: m[0] * px + m[4] * py + m[8] * pz + m[12],
				y: m[1] * px + m[5] * py + m[9] * pz + m[13],
				z: m[2] * px + m[6] * py + m[10] * pz + m[14],
				vx: m[0] * vx + m[4] * vy + m[8] * vz,
				vy: m[1] * vx + m[5] * vy + m[9] * vz,
				vz: m[2] * vx + m[6] * vy + m[10] * vz,
				age: 0,
				life: def.life * (1 + rand(def.lifeVary)),
				size: scale * (1 + rand(def.scaleVary)),
				gravity: def.gravity * scale,
				angle: def.baseSpin + rand(def.baseSpinVary),
				spin: def.spin + rand(def.spinVary),
				cell: def.randomCell ? Math.floor(Math.random() * cells) : 0,
				def,
				anchor: state.anchors?.[i],
			});
		}
	}

	private simulate(g: Group, dt: number): void {
		const list = g.particles;
		const offset = g.offset.array as Float32Array;
		const color = g.color.array as Float32Array;
		const shape = g.shape.array as Float32Array;
		let n = 0;
		for (let i = 0; i < list.length; i++) {
			const p = list[i];
			p.age += dt;
			if (p.age >= p.life) continue;
			const def = p.def;
			// World y is up.
			p.vy -= p.gravity * dt;
			if (def.drag > 0) {
				const keep = Math.max(0, 1 - def.drag * dt);
				p.vx *= keep; p.vy *= keep; p.vz *= keep;
			}
			p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
			p.angle += p.spin * dt;
			const t = p.age / p.life;
			list[n] = p;
			offset[n * 3] = p.x; offset[n * 3 + 1] = p.y; offset[n * 3 + 2] = p.z;
			color[n * 4] = lifeValue(def.color, t, 3, 0, 1);
			color[n * 4 + 1] = lifeValue(def.color, t, 3, 1, 1);
			color[n * 4 + 2] = lifeValue(def.color, t, 3, 2, 1);
			color[n * 4 + 3] = lifeValue(def.alpha, t, 1, 0, 1);
			shape[n * 3] = lifeValue(def.scale, t, 1, 0, 1) * p.size;
			shape[n * 3 + 1] = p.angle;
			const cells = def.rows * def.cols;
			shape[n * 3 + 2] = def.cell.times.length ? Math.min(cells - 1, Math.floor(lifeValue(def.cell, t, 1, 0, 0))) : p.cell;
			n++;
		}
		list.length = n;
		g.mesh.geometry.instanceCount = n;
		g.mesh.visible = n > 0;
		if (n) {
			for (const a of [g.offset, g.color, g.shape]) {
				a.clearUpdateRanges();
				a.addUpdateRange(0, n * a.itemSize);
				a.needsUpdate = true;
			}
		}
	}

	dispose(): void {
		for (const g of this.groups.values()) {
			g.mesh.geometry.dispose();
			g.mesh.material.dispose();
		}
		this.groups.clear();
		this.states.clear();
	}
}
