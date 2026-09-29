import * as THREE from 'three';
import type { TextureData, TextureFormat } from '../formats/blp';

const COMPRESSED_FORMATS: Record<Exclude<TextureFormat, 'rgba'>, THREE.CompressedPixelFormat> = {
	dxt1: THREE.RGB_S3TC_DXT1_Format,
	dxt3: THREE.RGBA_S3TC_DXT3_Format,
	dxt5: THREE.RGBA_S3TC_DXT5_Format,
};

/** Whether DXT textures can go to the GPU as-is (including sRGB decoding, which the map textures need). */
export function supportsCompressedTextures(renderer: THREE.WebGLRenderer): boolean {
	return renderer.extensions.has('WEBGL_compressed_texture_s3tc') && renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb');
}

export function createTexture(data: TextureData, anisotropy: number, repeat = false): THREE.Texture {
	let texture: THREE.Texture;
	if (data.format === 'rgba') {
		const mip = data.mips[0];
		texture = new THREE.DataTexture(mip.data, mip.width, mip.height, THREE.RGBAFormat);
		texture.generateMipmaps = true;
	} else {
		texture = new THREE.CompressedTexture(data.mips, data.width, data.height, COMPRESSED_FORMATS[data.format]);
	}
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.anisotropy = anisotropy;
	texture.needsUpdate = true;
	return texture;
}
