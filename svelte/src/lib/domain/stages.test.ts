import { describe, expect, it } from 'vitest';
import {
	canSetStage,
	defaultStageKey,
	fundedGateKey,
	funnelStages,
	stageLabel,
	terminalStageKeys,
	type PipelineStage
} from './stages';

const STAGES: PipelineStage[] = [
	{
		key: 'identified',
		label: 'Identified',
		order: 1,
		kind: 'funnel',
		accent: 'slate',
		isDefault: true,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'vetted',
		label: 'Vetted',
		order: 2,
		kind: 'funnel',
		accent: 'sky',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'funded',
		label: 'Funded',
		order: 4,
		kind: 'funnel',
		accent: 'amber',
		isDefault: false,
		isFundedGate: true,
		isSystem: true
	},
	{
		key: 'cancelled',
		label: 'Cancelled',
		order: 5,
		kind: 'terminal',
		accent: 'red',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'freed_by_other',
		label: 'Freed by other',
		order: 6,
		kind: 'terminal',
		accent: 'stone',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	}
];

describe('pipeline stage helpers', () => {
	it('funnelStages returns non-terminal stages in order', () => {
		expect(funnelStages(STAGES).map((s) => s.key)).toEqual(['identified', 'vetted', 'funded']);
	});

	it('terminalStageKeys returns the off-ramps', () => {
		expect(terminalStageKeys(STAGES)).toEqual(['cancelled', 'freed_by_other']);
	});

	it('defaultStageKey returns the isDefault stage', () => {
		expect(defaultStageKey(STAGES)).toBe('identified');
	});

	it('fundedGateKey returns the isFundedGate stage', () => {
		expect(fundedGateKey(STAGES)).toBe('funded');
	});

	it('stageLabel resolves a key, falling back to the key', () => {
		expect(stageLabel(STAGES, 'vetted')).toBe('Vetted');
		expect(stageLabel(STAGES, 'unknown')).toBe('unknown');
	});
});

describe('canSetStage', () => {
	const keys = STAGES.map((s) => s.key);

	it('allows any known stage to any other', () => {
		expect(canSetStage('identified', 'funded', keys).allowed).toBe(true);
		expect(canSetStage('funded', 'cancelled', keys).allowed).toBe(true);
	});

	it('rejects a no-op set to the same stage', () => {
		expect(canSetStage('vetted', 'vetted', keys).allowed).toBe(false);
		expect(canSetStage('vetted', 'vetted', keys).reason).toMatch(/Already/);
	});

	it('rejects an unknown stage when validKeys is provided', () => {
		const result = canSetStage('vetted', 'nonsense', keys);
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/Invalid stage/);
	});

	it('rejects an empty next stage', () => {
		expect(canSetStage('vetted', '', keys).allowed).toBe(false);
	});
});
