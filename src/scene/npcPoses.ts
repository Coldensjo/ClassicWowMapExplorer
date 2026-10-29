import { NPC_POSES, type NpcPose } from './types';

/**
 * The sequences each NPC pose holds (spec 7.9.1), as AnimationData IDs in order of preference:
 * the model plays the first it has, else it stands. Sitting is on the ground (SitGround, or the
 * emote the simpler creature models carry instead), kneeling KneelLoop, lying down Sleep, and
 * dead the Dead corpse pose, or, for the many models without one, the last frame of Death held
 * still (a negative ID asks for a sequence's end).
 */
const POSE_SEQUENCES: Record<NpcPose, number[]> = {
	sit: [97, 72],
	kneel: [115, 75],
	lie: [100, 71],
	dead: [6, -1],
};

export const POSE_LABELS: Record<NpcPose, string> = { sit: 'Sitting', kneel: 'Kneeling', lie: 'Lying down', dead: 'Dead' };

/** The sequences a pose tries, in order. */
export const poseSequences = (pose: NpcPose): number[] => POSE_SEQUENCES[pose];

export const isNpcPose = (v: unknown): v is NpcPose => typeof v === 'string' && (NPC_POSES as string[]).includes(v);
