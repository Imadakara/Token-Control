import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Тест-файлы пересоздают общую тестовую БД — только последовательно
    fileParallelism: false,
  },
});
