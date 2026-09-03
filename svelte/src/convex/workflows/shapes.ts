// The authored shapes, declared once and shared by the draft, the published
// snapshot and the editor's arguments. Three copies of a nested validator is
// three places for them to drift.
import { v } from 'convex/values';

export const objectiveInput = v.object({
	key: v.string(),
	label: v.string(),
	description: v.string(),
	minRating: v.optional(v.number()),
	minConfidence: v.optional(v.number()),
	maxAttempts: v.optional(v.number()),
	skipIfKnown: v.optional(v.boolean()),
	requires: v.optional(
		v.array(v.union(v.literal('hasChildren'), v.literal('hasSchoolAgeChildren')))
	),
	capture: v.optional(
		v.union(
			v.object({ kind: v.literal('none') }),
			v.object({
				kind: v.literal('field'),
				entity: v.union(v.literal('project'), v.literal('contact')),
				fieldKey: v.string(),
				options: v.optional(v.array(v.string()))
			})
		)
	)
});

export const stepInput = v.object({
	key: v.string(),
	title: v.string(),
	entryMessage: v.optional(v.string()),
	objectives: v.array(objectiveInput)
});

export const reportInput = v.object({
	titleGuidance: v.string(),
	instructions: v.string(),
	sections: v.array(
		v.object({
			key: v.string(),
			label: v.string(),
			guidance: v.string(),
			approxWords: v.optional(v.number())
		})
	)
});

export const promptInput = v.object({ content: v.string(), model: v.string() });

export const promptsInput = v.object({
	responder: promptInput,
	judge: promptInput,
	drafter: promptInput
});

export const triggerInput = v.union(
	v.object({ kind: v.literal('manual') }),
	v.object({ kind: v.literal('stage_change'), stageKey: v.string() }),
	v.object({ kind: v.literal('schedule'), everyMonths: v.number() })
);
