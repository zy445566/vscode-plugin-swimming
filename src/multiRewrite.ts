export function getNextRoundRobinIndex(
    eligibleTargets: readonly boolean[],
    startIndex: number
) {
    if (!eligibleTargets.length) {
        return undefined;
    }

    const normalizedStart = ((startIndex % eligibleTargets.length)
        + eligibleTargets.length) % eligibleTargets.length;
    for (let offset = 0; offset < eligibleTargets.length; offset += 1) {
        const index = (normalizedStart + offset) % eligibleTargets.length;
        if (eligibleTargets[index]) {
            return index;
        }
    }

    return undefined;
}
