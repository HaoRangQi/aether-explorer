import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Archive, Database, FolderOpen, HardDrive, RefreshCw, ShieldCheck, TrendingUp, Upload, Usb } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { VolumeInfo } from '../types';
import { normalizeAppError } from '../lib/app-error';
import { usePrefersReducedMotion } from '../lib/use-prefers-reduced-motion';

interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  capacity: string;
  capacity_value: number;
  mount: string;
}

const categoryRows = [
  { name: '应用与工具', detail: '/Applications 与开发工具', icon: Archive, tone: 'text-blue-400', value: '建议定期清理旧版本' },
  { name: '下载与临时文件', detail: '~/Downloads、缓存与安装包', icon: FolderOpen, tone: 'text-yellow-400', value: '最容易释放空间' },
  { name: '项目与归档', detail: '代码仓库、压缩包、构建产物', icon: Database, tone: 'text-green-400', value: '建议开启按目录分析' },
];

export default function StorageView() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [primaryDisk, setPrimaryDisk] = useState<DiskInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const messageTimerRef = useRef<number | null>(null);

  const loadVolumes = () => {
    setLoading(true);
    setError('');
    Promise.all([
      invoke<VolumeInfo[]>('list_volumes'),
      invoke<DiskInfo>('get_disk_info', { path: '/' }),
    ])
      .then(([volumeItems, diskInfo]) => {
        setVolumes(volumeItems);
        setPrimaryDisk(diskInfo);
      })
      .catch(err => setError(normalizeAppError(err).userMessage))
      .finally(() => setLoading(false));
  };

  const ejectVolume = async (volume: VolumeInfo) => {
    try {
      await invoke('eject_volume', { path: volume.path });
      setMessage(`已弹出 ${volume.name}`);
      loadVolumes();
    } catch (err) {
      setMessage(`弹出失败：${normalizeAppError(err).userMessage}`);
    }
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(''), 3200);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      invoke<VolumeInfo[]>('list_volumes'),
      invoke<DiskInfo>('get_disk_info', { path: '/' }),
    ])
      .then(([items, diskInfo]) => {
        if (!cancelled) {
          setVolumes(items);
          setPrimaryDisk(diskInfo);
        }
      })
      .catch(err => {
        if (!cancelled) setError(normalizeAppError(err).userMessage);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, []);

  const primaryVolume = volumes.find(volume => volume.is_root) || volumes[0];
  const primaryCapacity = primaryDisk?.capacity_value ?? primaryVolume?.capacity_value ?? 0;
  const healthLabel = useMemo(() => {
    if (!primaryDisk && !primaryVolume) return '等待数据';
    if (primaryCapacity >= 90) return '空间紧张';
    if (primaryCapacity >= 75) return '需要关注';
    return '状态良好';
  }, [primaryDisk, primaryVolume, primaryCapacity]);

  return (
    <div className="h-full overflow-y-auto p-10 bg-primary/[0.01] custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex items-start justify-between gap-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary/10 rounded-full border border-primary/20">
              <HardDrive className="w-3.5 h-3.5 text-primary" />
              <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">Storage Overview</span>
            </div>
            <div className="space-y-3">
              <h1 className="text-[44px] font-black text-on-surface tracking-tighter leading-none">存储空间</h1>
              <p className="text-on-surface/45 text-[15px] max-w-2xl leading-relaxed">
                汇总本机根卷与已挂载磁盘的容量状态，后续可扩展为按目录扫描、缓存清理和大文件定位。
              </p>
            </div>
          </div>
          <button
            onClick={loadVolumes}
            className="h-11 px-5 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center gap-2 shadow-xl shadow-primary/20 hover:brightness-105 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-5 py-4 text-[13px] text-red-300 font-bold">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-2xl border border-primary/20 bg-primary/10 px-5 py-4 text-[13px] text-primary font-bold">
            {message}
          </div>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
          <div className="bg-primary/5 border border-primary/10 rounded-[32px] p-7 space-y-7 overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-[18px] font-black text-on-surface">主磁盘</h2>
                <p className="text-[12px] text-on-surface/40 mt-1 truncate">{primaryDisk?.mount || primaryVolume?.path || '/'}</p>
              </div>
              <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-black">{healthLabel}</span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[176px_minmax(0,1fr)] gap-6 items-center">
              <div className="relative w-40 h-40 shrink-0 flex items-center justify-center mx-auto xl:mx-0">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" stroke="rgba(var(--primary-rgb),0.12)" strokeWidth="10" fill="none" />
                  <motion.circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="var(--primary)"
                    strokeWidth="10"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={314}
                    initial={prefersReducedMotion ? false : { strokeDashoffset: 314 }}
                    animate={{ strokeDashoffset: 314 - (314 * primaryCapacity) / 100 }}
                    transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.6, ease: 'circOut' }}
                  />
                </svg>
                <div className="text-center">
                  <p className="text-[32px] font-black text-on-surface leading-none">{primaryDisk?.capacity || primaryVolume?.capacity || '--'}</p>
                  <p className="text-[10px] font-black text-on-surface/35 uppercase tracking-widest mt-2">已使用</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                {[
                  ['总容量', primaryDisk?.size || primaryVolume?.size || '--'],
                  ['已使用', primaryDisk?.used || primaryVolume?.used || '--'],
                  ['可用空间', primaryDisk?.available || primaryVolume?.available || '--'],
                  ['文件系统', primaryDisk?.filesystem || primaryVolume?.filesystem || '--'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
                    <p className="text-[10px] font-black text-on-surface/35 uppercase tracking-wider truncate">{label}</p>
                    <p className="text-[16px] font-black text-on-surface mt-2 break-words leading-tight">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-primary/5 border border-primary/10 rounded-[32px] p-8 space-y-5">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h2 className="text-[18px] font-black text-on-surface">空间建议</h2>
            </div>
            {categoryRows.map(row => (
              <div key={row.name} className="flex items-center gap-4 rounded-2xl bg-primary/5 border border-transparent px-5 py-4">
                <div className="w-10 h-10 rounded-xl bg-on-surface/[0.04] flex items-center justify-center shrink-0">
                  <row.icon className={`w-5 h-5 ${row.tone}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-black text-on-surface truncate">{row.name}</p>
                  <p className="text-[11px] text-on-surface/35 truncate">{row.detail}</p>
                </div>
                <span className="text-[10px] font-black text-primary/80 bg-primary/10 px-3 py-1 rounded-full whitespace-nowrap">{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-primary/5 border border-primary/10 rounded-[32px] p-8 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-[18px] font-black text-on-surface">已挂载卷</h2>
            </div>
            <span className="text-[11px] font-black text-on-surface/35">{loading ? '扫描中' : `${volumes.length} 个卷 · ${volumes.filter(v => v.is_external).length} 个外置`}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {volumes.map(volume => (
              <div key={volume.path} className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <HardDrive className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-black text-on-surface truncate">{volume.name}</p>
                      <p className="text-[11px] text-on-surface/35 font-mono truncate">{volume.path}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {volume.is_external && <span className="inline-flex items-center gap-1 text-[9px] font-black text-primary bg-primary/10 px-2 py-1 rounded-full"><Usb className="w-3 h-3" /> USB</span>}
                    <span className="text-[11px] font-black text-primary">{volume.capacity}</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-on-surface/10 overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${volume.capacity_value}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <span className="text-on-surface/35">已用 <b className="text-on-surface/70">{volume.used}</b></span>
                  <span className="text-on-surface/35">可用 <b className="text-on-surface/70">{volume.available}</b></span>
                  <span className="text-on-surface/35">总计 <b className="text-on-surface/70">{volume.size}</b></span>
                </div>
                {volume.is_ejectable && (
                  <button
                    onClick={() => ejectVolume(volume)}
                    className="w-full py-2 rounded-xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors"
                  >
                    <Upload className="w-4 h-4" /> 安全弹出
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
