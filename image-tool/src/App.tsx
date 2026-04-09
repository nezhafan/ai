import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path';
import { ImageProcessor } from './components/ImageProcessor';

function shortenPath(path: string) {
  if (!path) {
    return '选择输出文件夹';
  }

  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) {
    return path;
  }

  return parts[parts.length - 1];
}

export default function App() {
  const [outputDir, setOutputDir] = useState('');
  const [concurrency, setConcurrency] = useState(2);

  useEffect(() => {
    let cancelled = false;

    const loadDefaultOutputDir = async () => {
      try {
        const defaultDir = await downloadDir();
        if (!cancelled) {
          setOutputDir(defaultDir);
        }
      } catch {
        if (!cancelled) {
          setOutputDir('');
        }
      }
    };

    void loadDefaultOutputDir();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectOutputDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (typeof selected === 'string') {
      setOutputDir(selected);
    }
  };

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-50">
      <div className="flex min-h-screen flex-col lg:h-screen lg:flex-row">
        <aside className="flex w-full flex-col border-b border-zinc-800 bg-zinc-900/92 p-5 backdrop-blur lg:w-80 lg:border-b-0 lg:border-r">
          <div className="mb-8">
            <h1 className="text-2xl font-bold">图片工具</h1>
            <p className="mt-1 text-sm text-zinc-500">本地图片处理</p>
          </div>

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">输出文件夹</p>
              <button
                onClick={handleSelectOutputDir}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-left text-sm text-zinc-300 transition-colors hover:border-zinc-500"
                title={outputDir}
              >
                <span className="text-base text-zinc-400" aria-hidden="true">📁</span>
                <span className="min-w-0 flex-1 truncate">{shortenPath(outputDir)}</span>
                <span className="text-xs text-zinc-500" aria-hidden="true">更换</span>
              </button>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">同时处理图片数</p>
                <span className="text-sm text-zinc-400">{concurrency}</span>
              </div>
              <div className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3">
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="1"
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-blue-500"
                />
                <div className="mt-2 flex justify-between text-xs text-zinc-500">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-8 text-xs text-zinc-500">
            <div className="border-t border-zinc-800 pt-4">
              所有处理在本地完成
              <br />
              图片不会上传到服务器
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl p-5 lg:p-8">
            <ImageProcessor outputDir={outputDir} concurrency={concurrency} />
          </div>
        </main>
      </div>
    </div>
  );
}
