/** Poses an NPC can hold, by AnimationData ID, in groups for the picker. */
export const POSES: [string, [number, string][]][] = [
	['Posture', [
		[0, 'Stand'], [97, 'Sit on the ground'], [102, 'Sit in a low chair'], [103, 'Sit in a chair'], [104, 'Sit in a high chair'],
		[115, 'Kneel'], [100, 'Sleep'], [6, 'Lie dead'],
	]],
	['Talk and emotes', [
		[60, 'Talk'], [64, 'Talk, exclaiming'], [65, 'Talk, asking'], [67, 'Wave'], [66, 'Bow'], [113, 'Salute'], [68, 'Cheer'],
		[80, 'Applaud'], [70, 'Laugh'], [69, 'Dance'], [84, 'Point'], [82, 'Flex'], [81, 'Shout'], [74, 'Roar'], [77, 'Cry'],
		[79, 'Beg'], [83, 'Shy'], [76, 'Kiss'], [73, 'Rude'], [78, 'Chicken'],
	]],
	['Work', [[62, 'Work'], [123, 'Use something'], [122, 'Eat'], [134, 'Fish'], [50, 'Loot']]],
	['Combat', [
		[25, 'Ready, unarmed'], [26, 'Ready, one-handed'], [27, 'Ready, two-handed'], [29, 'Ready, bow'], [48, 'Ready, rifle'],
		[16, 'Fight, unarmed'], [17, 'Fight, one-handed'], [18, 'Fight, two-handed'], [24, 'Block with a shield'],
		[51, 'Ready a spell'], [32, 'Cast a spell'], [124, 'Channel a spell'], [55, 'Battle roar'], [14, 'Stunned'], [120, 'Stealth'],
	]],
	['Other', [[41, 'Swim in place'], [91, 'Ride (without the mount)'], [132, 'Drowned']]],
];

/** What a model can show for a pose: the pose itself, or what stands in for it (see the loader's fallbacks). */
const POSE_STAND_INS: Record<number, number[]> = { 102: [103, 97], 104: [103, 97], 103: [102, 104, 97], 115: [75], 122: [61], 123: [63], 6: [1] };

/** Whether a model with these animations can show a pose. */
export function canPose(animations: number[], pose: number): boolean {
	return [pose, ...(POSE_STAND_INS[pose] ?? [])].some((id) => animations.includes(id));
}
