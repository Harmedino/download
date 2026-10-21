import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ffmpeg-heavy tests run several times slower on shared CI runners.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: 'test', MONGO_URI: 'mongodb://127.0.0.1:27017/snapgrab-test', TEMP_DIR: './tmp/test', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GROQ_API_KEY: '', DEEPGRAM_API_KEY: '', TRANSCRIBE_PROVIDER: 'auto', LLM_PROVIDER: 'auto' },
  },
});
