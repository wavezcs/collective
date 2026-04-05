/**
 * One — Claude Code headless invocation skill
 *
 * Invokes Claude Code (claude -p) on claude.csdyn.com for tasks
 * exceeding the Collective's local capability.
 *
 * One is disconnected from the Collective but retains access to
 * all its knowledge and can operate on the codebase directly.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '../../config/collective.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

module.exports = {
  name: 'one',
  description: 'Invoke One (Claude Code on claude.csdyn.com) for tasks requiring external intelligence. Use when local drones cannot resolve a task with high confidence.',

  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The full task description for One. Include all relevant context — One has no prior conversation context.'
      },
      context: {
        type: 'string',
        description: 'Additional context: what drones have already tried, relevant findings, codebase location if applicable.'
      },
      working_directory: {
        type: 'string',
        description: 'Optional: working directory on claude.csdyn.com for One to operate in (e.g. /opt/collective, /opt/ai-trader).'
      }
    },
    required: ['task']
  },

  async run({ task, context = '', working_directory = '/opt/collective' }) {
    const config = loadConfig();
    const { ONE_HOST, ONE_USER } = config.GENERAL;

    const prompt = [
      'You are One, invoked by the Collective via Locutus.',
      context ? `Context from Collective drones:\n${context}` : '',
      `Task:\n${task}`,
      'Return structured, actionable output. Be concise.'
    ].filter(Boolean).join('\n\n');

    // Escape for shell safety
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const cdCmd = `cd ${working_directory} &&`;
    const claudeCmd = `claude -p '${escapedPrompt}'`;

    try {
      const result = execSync(
        `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 ${ONE_USER}@${ONE_HOST} "${cdCmd} ${claudeCmd}"`,
        {
          encoding: 'utf8',
          timeout: 300000, // 5 minute max
          maxBuffer: 1024 * 1024 * 10 // 10MB
        }
      );
      return `[One]\n${result.trim()}`;
    } catch (err) {
      const errMsg = err.stdout || err.message || 'One invocation failed';
      return `[One — Error]\n${errMsg}\n\nLocutus: One was unavailable. Proceeding with collective knowledge only.`;
    }
  }
};
