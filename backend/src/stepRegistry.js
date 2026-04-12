import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SKILL_DIR = resolve(process.cwd(), 'predict-market-bot', 'skills');

export const STEP_REGISTRY = [
  { key: 'step1_scan', folder: 'scan', step: 1, run_endpoint: '/api/scan/run' },
  { key: 'step2_research', folder: 'research', step: 2, run_endpoint: '/api/research/run' },
  { key: 'step3_predict', folder: 'predict', step: 3, run_endpoint: '/api/predict/run' },
  { key: 'step4_execute', folder: 'execute', step: 4, run_endpoint: '/api/execute/run' },
  { key: 'step5_risk', folder: 'risk', step: 5, run_endpoint: '/api/risk/run' }
];

export function loadSkillProfiles() {
  return STEP_REGISTRY.map((item) => {
    const filePath = resolve(SKILL_DIR, item.folder, 'SKILL.md');
    const exists = existsSync(filePath);
    const body = exists ? readFileSync(filePath, 'utf8') : '';
    return {
      ...item,
      available: exists,
      file_path: filePath,
      title: body.split('\n')[0]?.replace(/^#\s*/, '') || item.key,
      preview: body.split('\n').slice(1, 6).join('\n').trim()
    };
  });
}

export function orderedStepKeys() {
  return STEP_REGISTRY.map((x) => x.key);
}
