import {
    type RESTGetAPIApplicationCommandResult,
    type RESTGetAPIApplicationCommandsResult,
    type RESTGetAPIApplicationGuildCommandResult,
    type RESTGetAPIApplicationGuildCommandsQuery,
    type RESTGetAPIApplicationGuildCommandsResult,
    type RESTGetAPIEntitlementsQuery,
    type RESTGetAPIEntitlementsResult,
    type RESTGetAPIGuildApplicationCommandsPermissionsResult,
    type RESTGetAPISKUsResult,
    type RESTGetCurrentApplicationResult,
    type RESTPatchAPIApplicationCommandJSONBody,
    type RESTPatchAPIApplicationCommandResult,
    type RESTPatchAPIApplicationGuildCommandJSONBody,
    type RESTPatchAPIApplicationGuildCommandResult,
    type RESTPatchCurrentApplicationJSONBody,
    type RESTPatchCurrentApplicationResult,
    type RESTPostAPIApplicationCommandsJSONBody,
    type RESTPostAPIApplicationCommandsResult,
    type RESTPostAPIApplicationGuildCommandsJSONBody,
    type RESTPostAPIApplicationGuildCommandsResult,
    type RESTPutAPIApplicationCommandsJSONBody,
    type RESTPutAPIApplicationCommandsResult,
    type RESTPutAPIApplicationGuildCommandsJSONBody,
    type RESTPutAPIApplicationGuildCommandsResult,
    Routes,
    type Snowflake,
} from "discord-api-types/v10";
import type { RestClient } from "../rest/rest.ts";
import { query } from "./shared.ts";

/** Application, application-command, entitlement and SKU endpoints. */
export class ApplicationsAPI {
    readonly #rest: RestClient;

    /** Creates the application API group. Usually accessed as `client.api.applications`. */
    constructor(rest: RestClient) {
        this.#rest = rest;
    }

    // --- application ---------------------------------------------------------------------------

    /** Gets the bot's own application. */
    async getCurrent(): Promise<RESTGetCurrentApplicationResult> {
        return await this.#rest.get(Routes.currentApplication());
    }

    /** Edits the bot's own application. */
    async editCurrent(body: RESTPatchCurrentApplicationJSONBody): Promise<RESTPatchCurrentApplicationResult> {
        return await this.#rest.patch(Routes.currentApplication(), { body });
    }

    // --- global commands -----------------------------------------------------------------------

    /** Lists the application's global commands. */
    async getGlobalCommands(applicationId: Snowflake): Promise<RESTGetAPIApplicationCommandsResult> {
        return await this.#rest.get(Routes.applicationCommands(applicationId));
    }

    /** Creates a global command. */
    async createGlobalCommand(
        applicationId: Snowflake,
        body: RESTPostAPIApplicationCommandsJSONBody,
    ): Promise<RESTPostAPIApplicationCommandsResult> {
        return await this.#rest.post(Routes.applicationCommands(applicationId), { body });
    }

    /** Gets a global command. */
    async getGlobalCommand(
        applicationId: Snowflake,
        commandId: Snowflake,
    ): Promise<RESTGetAPIApplicationCommandResult> {
        return await this.#rest.get(Routes.applicationCommand(applicationId, commandId));
    }

    /** Edits a global command. */
    async editGlobalCommand(
        applicationId: Snowflake,
        commandId: Snowflake,
        body: RESTPatchAPIApplicationCommandJSONBody,
    ): Promise<RESTPatchAPIApplicationCommandResult> {
        return await this.#rest.patch(Routes.applicationCommand(applicationId, commandId), { body });
    }

    /** Deletes a global command. */
    async deleteGlobalCommand(applicationId: Snowflake, commandId: Snowflake): Promise<void> {
        await this.#rest.delete(Routes.applicationCommand(applicationId, commandId));
    }

    /** Overwrites all global commands with the given array. */
    async bulkOverwriteGlobalCommands(
        applicationId: Snowflake,
        body: RESTPutAPIApplicationCommandsJSONBody,
    ): Promise<RESTPutAPIApplicationCommandsResult> {
        return await this.#rest.put(Routes.applicationCommands(applicationId), { body });
    }

    // --- guild commands ------------------------------------------------------------------------

    /** Lists the application's commands in a guild. */
    async getGuildCommands(
        applicationId: Snowflake,
        guildId: Snowflake,
        options?: RESTGetAPIApplicationGuildCommandsQuery,
    ): Promise<RESTGetAPIApplicationGuildCommandsResult> {
        return await this.#rest.get(Routes.applicationGuildCommands(applicationId, guildId), { query: query(options) });
    }

    /** Creates a command in a guild. */
    async createGuildCommand(
        applicationId: Snowflake,
        guildId: Snowflake,
        body: RESTPostAPIApplicationGuildCommandsJSONBody,
    ): Promise<RESTPostAPIApplicationGuildCommandsResult> {
        return await this.#rest.post(Routes.applicationGuildCommands(applicationId, guildId), { body });
    }

    /** Gets a command in a guild. */
    async getGuildCommand(
        applicationId: Snowflake,
        guildId: Snowflake,
        commandId: Snowflake,
    ): Promise<RESTGetAPIApplicationGuildCommandResult> {
        return await this.#rest.get(Routes.applicationGuildCommand(applicationId, guildId, commandId));
    }

    /** Edits a command in a guild. */
    async editGuildCommand(
        applicationId: Snowflake,
        guildId: Snowflake,
        commandId: Snowflake,
        body: RESTPatchAPIApplicationGuildCommandJSONBody,
    ): Promise<RESTPatchAPIApplicationGuildCommandResult> {
        return await this.#rest.patch(Routes.applicationGuildCommand(applicationId, guildId, commandId), { body });
    }

    /** Deletes a command in a guild. */
    async deleteGuildCommand(applicationId: Snowflake, guildId: Snowflake, commandId: Snowflake): Promise<void> {
        await this.#rest.delete(Routes.applicationGuildCommand(applicationId, guildId, commandId));
    }

    /** Overwrites all commands in a guild with the given array. */
    async bulkOverwriteGuildCommands(
        applicationId: Snowflake,
        guildId: Snowflake,
        body: RESTPutAPIApplicationGuildCommandsJSONBody,
    ): Promise<RESTPutAPIApplicationGuildCommandsResult> {
        return await this.#rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
    }

    /** Gets the permissions for all of the application's commands in a guild. */
    async getGuildCommandPermissions(
        applicationId: Snowflake,
        guildId: Snowflake,
    ): Promise<RESTGetAPIGuildApplicationCommandsPermissionsResult> {
        return await this.#rest.get(Routes.guildApplicationCommandsPermissions(applicationId, guildId));
    }

    // --- entitlements and SKUs -----------------------------------------------------------------

    /** Lists entitlements for the application. */
    async getEntitlements(
        applicationId: Snowflake,
        options?: RESTGetAPIEntitlementsQuery,
    ): Promise<RESTGetAPIEntitlementsResult> {
        return await this.#rest.get(Routes.entitlements(applicationId), { query: query(options) });
    }

    /** Lists the application's SKUs. */
    async getSKUs(applicationId: Snowflake): Promise<RESTGetAPISKUsResult> {
        return await this.#rest.get(Routes.skus(applicationId));
    }
}
