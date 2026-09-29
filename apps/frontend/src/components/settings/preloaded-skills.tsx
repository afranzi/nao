import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Empty } from '@/components/ui/empty';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface SettingsPreloadedSkillsProps {
	isAdmin: boolean;
}

export function SettingsPreloadedSkills({ isAdmin }: SettingsPreloadedSkillsProps) {
	const queryClient = useQueryClient();
	const skills = useQuery(trpc.skill.list.queryOptions());
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: (nextSettings) => {
				queryClient.setQueryData(trpc.project.getAgentSettings.queryOptions().queryKey, (previous) =>
					previous ? { ...previous, ...nextSettings } : previous,
				);
			},
		}),
	);

	const discoveredSkills = skills.data ?? [];
	const preloadedSkillNames = agentSettings.data?.skills?.preloaded ?? [];

	const handlePreloadChange = (skillName: string, preloaded: boolean) => {
		const discoveredNames = new Set(discoveredSkills.map((skill) => skill.name));
		const currentNames = preloadedSkillNames.filter((name) => discoveredNames.has(name) && name !== skillName);
		const nextPreloaded = preloaded ? [...currentNames, skillName] : currentNames;
		updateAgentSettings.mutate({ skills: { preloaded: nextPreloaded } });
	};

	return (
		<SettingsCard
			title='Preloaded skills'
			description='Load project skills in full at the start of every chat, so users do not need to mention them with /. Preloaded skills are sent with every message, which increases token usage and cost; very long skills are truncated and skills over the total budget are skipped.'
		>
			<PreloadedSkillsList
				isLoading={skills.isLoading}
				skills={discoveredSkills}
				preloadedSkillNames={preloadedSkillNames}
				disabled={!isAdmin || updateAgentSettings.isPending}
				onPreloadChange={handlePreloadChange}
			/>
		</SettingsCard>
	);
}

interface PreloadedSkillsListProps {
	isLoading: boolean;
	skills: { name: string; description: string; location: string }[];
	preloadedSkillNames: string[];
	disabled: boolean;
	onPreloadChange: (skillName: string, preloaded: boolean) => void;
}

function PreloadedSkillsList({
	isLoading,
	skills,
	preloadedSkillNames,
	disabled,
	onPreloadChange,
}: PreloadedSkillsListProps) {
	if (isLoading) {
		return <div className='text-sm text-muted-foreground py-1'>Loading…</div>;
	}

	if (skills.length === 0) {
		return (
			<Empty>
				No skills found. Add Markdown files under <code className='font-mono'>agent/skills/</code> in the
				project context.
			</Empty>
		);
	}

	return skills.map((skill, index) => {
		const switchId = toSwitchId(skill.name, index);
		return (
			<SettingsControlRow
				key={skill.location}
				id={switchId}
				label={skill.name}
				className='gap-4'
				description={<span className='line-clamp-2 break-words'>{skill.description || skill.location}</span>}
				control={
					<Switch
						id={switchId}
						checked={preloadedSkillNames.includes(skill.name)}
						onCheckedChange={(preloaded) => onPreloadChange(skill.name, preloaded)}
						disabled={disabled}
					/>
				}
			/>
		);
	});
}

function toSwitchId(skillName: string, index: number): string {
	const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	return `preload-skill-${index}-${slug}`;
}
