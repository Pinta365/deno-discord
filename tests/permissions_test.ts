import { assert, assertEquals } from "@std/assert";
import { type APIRole, OverwriteType, PermissionFlagsBits, type RoleFlags } from "discord-api-types/v10";
import { applyOverwrites, computeBasePermissions } from "../src/cache/permissions.ts";

const ALL_PERMISSIONS: bigint = Object.values(PermissionFlagsBits).reduce((acc, bit) => acc | bit, 0n);

const GUILD_ID = "100";
const OWNER_ID = "1";
const USER_ID = "2";
const ROLE_A = "200";
const ROLE_B = "201";
const UNKNOWN_ROLE = "999";

function role(id: string, permissions: bigint): APIRole {
    return {
        id,
        name: id,
        color: 0,
        hoist: false,
        icon: null,
        unicode_emoji: null,
        position: 0,
        permissions: permissions.toString(),
        managed: false,
        mentionable: false,
        flags: 0 as RoleFlags,
        colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
    } as APIRole;
}

function roleMap(...roles: APIRole[]): Map<string, APIRole> {
    return new Map(roles.map((r) => [r.id, r]));
}

Deno.test("owner gets all permissions", () => {
    const result = computeBasePermissions(GUILD_ID, OWNER_ID, OWNER_ID, [], roleMap());
    assertEquals(result, ALL_PERMISSIONS);
});

Deno.test("Administrator on @everyone grants all permissions", () => {
    const roles = roleMap(role(GUILD_ID, PermissionFlagsBits.Administrator));
    const result = computeBasePermissions(GUILD_ID, OWNER_ID, USER_ID, [], roles);
    assertEquals(result, ALL_PERMISSIONS);
});

Deno.test("Administrator on a member role grants all permissions", () => {
    const roles = roleMap(
        role(GUILD_ID, 0n),
        role(ROLE_A, PermissionFlagsBits.Administrator),
    );
    const result = computeBasePermissions(GUILD_ID, OWNER_ID, USER_ID, [ROLE_A], roles);
    assertEquals(result, ALL_PERMISSIONS);
});

Deno.test("@everyone and member role permissions are OR'd", () => {
    const roles = roleMap(
        role(GUILD_ID, PermissionFlagsBits.ViewChannel),
        role(ROLE_A, PermissionFlagsBits.SendMessages),
    );
    const result = computeBasePermissions(GUILD_ID, OWNER_ID, USER_ID, [ROLE_A], roles);
    assertEquals(result, PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages);
});

Deno.test("unknown role ids are ignored", () => {
    const roles = roleMap(
        role(GUILD_ID, PermissionFlagsBits.ViewChannel),
        role(ROLE_A, PermissionFlagsBits.SendMessages),
    );
    const result = computeBasePermissions(GUILD_ID, OWNER_ID, USER_ID, [ROLE_A, UNKNOWN_ROLE], roles);
    assertEquals(result, PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages);
});

Deno.test("Administrator base ignores overwrites", () => {
    const base = PermissionFlagsBits.Administrator;
    const overwrites = [
        { id: GUILD_ID, type: OverwriteType.Role, allow: "0", deny: PermissionFlagsBits.ViewChannel.toString() },
        { id: USER_ID, type: OverwriteType.Member, allow: "0", deny: PermissionFlagsBits.SendMessages.toString() },
    ];
    const result = applyOverwrites(base, GUILD_ID, USER_ID, [], overwrites);
    assertEquals(result, ALL_PERMISSIONS);
});

Deno.test("overwrites are applied in order: @everyone, roles, then member", () => {
    const base = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
    const overwrites = [
        { id: GUILD_ID, type: OverwriteType.Role, allow: "0", deny: PermissionFlagsBits.ViewChannel.toString() },
        { id: ROLE_A, type: OverwriteType.Role, allow: PermissionFlagsBits.ViewChannel.toString(), deny: "0" },
        { id: USER_ID, type: OverwriteType.Member, allow: "0", deny: PermissionFlagsBits.ViewChannel.toString() },
    ];
    const result = applyOverwrites(base, GUILD_ID, USER_ID, [ROLE_A], overwrites);
    assertEquals(result, PermissionFlagsBits.SendMessages);
});

Deno.test("role overwrites aggregate: allow wins if one role allows and another denies", () => {
    const base = 0n;
    const overwrites = [
        {
            id: ROLE_A,
            type: OverwriteType.Role,
            allow: PermissionFlagsBits.ViewChannel.toString(),
            deny: PermissionFlagsBits.SendMessages.toString(),
        },
        { id: ROLE_B, type: OverwriteType.Role, allow: "0", deny: PermissionFlagsBits.ViewChannel.toString() },
    ];
    const result = applyOverwrites(base, GUILD_ID, USER_ID, [ROLE_A, ROLE_B], overwrites);
    assert((result & PermissionFlagsBits.ViewChannel) !== 0n);
    assertEquals(result & PermissionFlagsBits.SendMessages, 0n);
});

Deno.test("overwrites for roles the member does not have are ignored", () => {
    const base = 0n;
    const overwrites = [
        { id: ROLE_A, type: OverwriteType.Role, allow: PermissionFlagsBits.SendMessages.toString(), deny: "0" },
    ];
    const result = applyOverwrites(base, GUILD_ID, USER_ID, [ROLE_B], overwrites);
    assertEquals(result, 0n);
});

Deno.test("@everyone overwrite then member overwrite: member wins", () => {
    const base = PermissionFlagsBits.ViewChannel;
    const overwrites = [
        { id: GUILD_ID, type: OverwriteType.Role, allow: "0", deny: PermissionFlagsBits.ViewChannel.toString() },
        {
            id: USER_ID,
            type: OverwriteType.Member,
            allow: PermissionFlagsBits.ViewChannel.toString(),
            deny: "0",
        },
    ];
    const result = applyOverwrites(base, GUILD_ID, USER_ID, [], overwrites);
    assertEquals(result, PermissionFlagsBits.ViewChannel);
});
