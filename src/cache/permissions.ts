import { type APIOverwrite, type APIRole, OverwriteType, PermissionFlagsBits } from "discord-api-types/v10";

const ALL_PERMISSIONS: bigint = Object.values(PermissionFlagsBits).reduce((acc, bit) => acc | bit, 0n);

/**
 * Computes a member's guild-level permissions (ignoring channel overwrites).
 * Follows https://discord.com/developers/docs/topics/permissions#permission-overwrites.
 *
 * @param guildId Guild ID (also the ID of the @everyone role).
 * @param ownerId Guild owner's user ID.
 * @param userId The member's user ID.
 * @param memberRoleIds The member's role IDs.
 * @param roles All roles in the guild, by ID.
 */
export function computeBasePermissions(
    guildId: string,
    ownerId: string,
    userId: string,
    memberRoleIds: readonly string[],
    roles: ReadonlyMap<string, APIRole>,
): bigint {
    if (userId === ownerId) return ALL_PERMISSIONS;
    let permissions = BigInt(roles.get(guildId)?.permissions ?? 0);
    for (const id of memberRoleIds) {
        const role = roles.get(id);
        if (role) permissions |= BigInt(role.permissions);
    }
    if (permissions & PermissionFlagsBits.Administrator) return ALL_PERMISSIONS;
    return permissions;
}

/**
 * Applies channel permission overwrites to guild-level permissions.
 *
 * @param base Result of {@link computeBasePermissions}.
 * @param guildId Guild ID (the @everyone overwrite uses it as its ID).
 * @param userId The member's user ID.
 * @param memberRoleIds The member's role IDs.
 * @param overwrites The channel's permission overwrites.
 */
export function applyOverwrites(
    base: bigint,
    guildId: string,
    userId: string,
    memberRoleIds: readonly string[],
    overwrites: readonly APIOverwrite[],
): bigint {
    if (base & PermissionFlagsBits.Administrator) return ALL_PERMISSIONS;
    let permissions = base;

    const everyone = overwrites.find((o) => o.id === guildId);
    if (everyone) permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);

    let allow = 0n;
    let deny = 0n;
    for (const o of overwrites) {
        if (o.type === OverwriteType.Role && o.id !== guildId && memberRoleIds.includes(o.id)) {
            allow |= BigInt(o.allow);
            deny |= BigInt(o.deny);
        }
    }
    permissions = (permissions & ~deny) | allow;

    const member = overwrites.find((o) => o.type === OverwriteType.Member && o.id === userId);
    if (member) permissions = (permissions & ~BigInt(member.deny)) | BigInt(member.allow);

    return permissions;
}
