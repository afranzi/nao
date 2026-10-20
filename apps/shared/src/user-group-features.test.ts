import { describe, expect, it } from 'vitest';

import {
	DEFAULT_USER_GROUP_CONFIG,
	parseStoredUserGroupConfig,
	resolvePreloadedSkills,
	resolveProjectSharingPermission,
	serializeUserGroupConfig,
	USER_GROUP_FEATURES,
} from './user-group-features';

const DEFAULT_TOOL_CALL_DENSITY = { defaultDensity: 'detailed', canChange: true } as const;

describe('user group configuration', () => {
	it('uses canonical v2 configuration for new groups', () => {
		expect(DEFAULT_USER_GROUP_CONFIG).toEqual({
			version: 2,
			features: [],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
	});

	it('serializes canonical v2 configuration without compact-mode', () => {
		expect(
			serializeUserGroupConfig(['storyCreation', 'automationCreation', 'compact-mode'], {
				defaultDensity: 'compact',
				canChange: false,
			}),
		).toEqual({
			version: 2,
			features: ['storyCreation', 'automationCreation'],
			toolCallDensity: {
				defaultDensity: 'compact',
				canChange: false,
			},
			projectSharing: 'inherit',
			preloadedSkills: [],
		});
		expect(USER_GROUP_FEATURES).toEqual(['storyCreation', 'customStoryCreation', 'automationCreation']);
	});

	it('serializes the project sharing permission', () => {
		expect(serializeUserGroupConfig([], { defaultDensity: 'detailed', canChange: true }, 'blocked')).toMatchObject({
			projectSharing: 'blocked',
		});
	});

	it('serializes trimmed, deduplicated preloaded skills', () => {
		expect(
			serializeUserGroupConfig([], DEFAULT_TOOL_CALL_DENSITY, 'inherit', [' revenue ', 'churn', 'revenue', '']),
		).toMatchObject({ preloadedSkills: ['revenue', 'churn'] });
	});

	it('reads preloaded skills and ignores invalid entries', () => {
		expect(
			parseStoredUserGroupConfig({
				version: 2,
				features: [],
				toolCallDensity: DEFAULT_TOOL_CALL_DENSITY,
				preloadedSkills: ['revenue', 42, ' churn '],
			}).preloadedSkills,
		).toEqual(['revenue', 'churn']);
		expect(
			parseStoredUserGroupConfig({ version: 2, features: [], toolCallDensity: DEFAULT_TOOL_CALL_DENSITY })
				.preloadedSkills,
		).toEqual([]);
	});

	it('reads canonical v2 configuration', () => {
		expect(
			parseStoredUserGroupConfig({
				version: 2,
				features: ['storyCreation', 'automationCreation'],
				toolCallDensity: {
					defaultDensity: 'compact',
					canChange: true,
				},
				projectSharing: 'allowed',
			}),
		).toEqual({
			features: ['storyCreation', 'automationCreation'],
			toolCallDensity: {
				defaultDensity: 'compact',
				canChange: true,
			},
			projectSharing: 'allowed',
			preloadedSkills: [],
		});
	});

	it('inherits project sharing when the stored permission is missing or unknown', () => {
		const toolCallDensity = { defaultDensity: 'detailed', canChange: true };
		expect(parseStoredUserGroupConfig({ version: 2, features: [], toolCallDensity }).projectSharing).toBe(
			'inherit',
		);
		expect(
			parseStoredUserGroupConfig({ version: 2, features: [], toolCallDensity, projectSharing: 'everyone' })
				.projectSharing,
		).toBe('inherit');
	});

	it('maps legacy compact-mode to an unlocked detailed policy', () => {
		expect(parseStoredUserGroupConfig(['story-creation', 'compact-mode'])).toEqual({
			features: ['storyCreation'],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: true,
			},
			projectSharing: 'inherit',
			preloadedSkills: [],
		});
	});

	it('maps legacy configuration without compact-mode to a locked detailed policy', () => {
		expect(parseStoredUserGroupConfig(['story-creation'])).toEqual({
			features: ['storyCreation'],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: false,
			},
			projectSharing: 'inherit',
			preloadedSkills: [],
		});
	});

	it.each([
		['stories', 'storyCreation'],
		['story-creation', 'storyCreation'],
		['automations', 'automationCreation'],
		['automation-creation', 'automationCreation'],
	])('normalizes the legacy %s alias', (alias, feature) => {
		expect(parseStoredUserGroupConfig([alias])).toEqual({
			features: [feature],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: false,
			},
			projectSharing: 'inherit',
			preloadedSkills: [],
		});
	});

	it('removes unknown legacy features', () => {
		expect(parseStoredUserGroupConfig(['unknown'])).toEqual({
			features: [],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: false,
			},
			projectSharing: 'inherit',
			preloadedSkills: [],
		});
	});
});

describe('resolvePreloadedSkills', () => {
	it('puts All Users first, then the other groups by name, without duplicates', () => {
		expect(
			resolvePreloadedSkills([
				{ isDefault: false, name: 'Sales', preloadedSkills: ['pipeline', 'revenue'] },
				{ isDefault: false, name: 'Finance', preloadedSkills: ['revenue-recognition'] },
				{ isDefault: true, name: 'All Users', preloadedSkills: ['revenue'] },
			]),
		).toEqual(['revenue', 'revenue-recognition', 'pipeline']);
	});
});

describe('resolveProjectSharingPermission', () => {
	const allUsers = (projectSharing: 'inherit' | 'allowed' | 'blocked') => ({ isDefault: true, projectSharing });
	const group = (projectSharing: 'inherit' | 'allowed' | 'blocked') => ({ isDefault: false, projectSharing });

	it('falls back to the All Users default when no group overrides it', () => {
		expect(resolveProjectSharingPermission([allUsers('inherit'), group('inherit')])).toBe(true);
		expect(resolveProjectSharingPermission([allUsers('allowed')])).toBe(true);
		expect(resolveProjectSharingPermission([allUsers('blocked'), group('inherit')])).toBe(false);
	});

	it('lets an explicit allow override a restrictive default', () => {
		expect(resolveProjectSharingPermission([allUsers('blocked'), group('allowed')])).toBe(true);
	});

	it('lets an explicit block win over any explicit allow', () => {
		expect(resolveProjectSharingPermission([allUsers('allowed'), group('allowed'), group('blocked')])).toBe(false);
	});
});
