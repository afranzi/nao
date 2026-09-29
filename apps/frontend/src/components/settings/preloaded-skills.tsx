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
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const preloadedSkillNames = agentSettings.data?.skills?.preloaded ?? [];

	const handlePreloadChange = (skillName: string, preloaded: boolean) => {
		const nextPreloaded = preloaded
			? [...preloadedSkillNames, skillName]
			: preloadedSkillNames.filter((name) => name !== skillName);
		updateAgentSettings.mutate({ skills: { preloaded: nextPreloaded } });
	};

	return (
		<SettingsCard
			title='Preloaded skills'
			description='Load project skills in full at the start of every chat, so users do not need to mention them with /. Preloaded skills are sent with every message, which increases token usage and cost; very long skills are truncated and skills over the total budget are skipped.'
		>
			{skills.data?.length ? (
				skills.data.map((skill) => (
					<SettingsControlRow
						key={skill.name}
						id={`preload-skill-${skill.name}`}
						label={skill.name}
						description={skill.description || skill.location}
						control={
							<Switch
								id={`preload-skill-${skill.name}`}
								checked={preloadedSkillNames.includes(skill.name)}
								onCheckedChange={(preloaded) => handlePreloadChange(skill.name, preloaded)}
								disabled={!isAdmin || updateAgentSettings.isPending}
							/>
						}
					/>
				))
			) : (
				<Empty>
					No skills found. Add Markdown files under <code className='font-mono'>agent/skills/</code> in the
					project context.
				</Empty>
			)}
		</SettingsCard>
	);
}
