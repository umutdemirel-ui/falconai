import { useState } from 'react';
import { Eye, FileSearch, FileText, FolderSearch, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, EmptyState, Field, IconChip, Panel } from '../components/ui';
import { formatBytes, formatRelative } from '../lib/utils';

const ICONS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'text/markdown': 'MD',
};

export function FilesView() {
  const files = useStore((s) => s.files);
  const refreshFiles = useStore((s) => s.refreshFiles);
  const removeFile = useStore((s) => s.removeFile);
  const pushToast = useStore((s) => s.pushToast);
  const setView = useStore((s) => s.setView);
  const setDraft = useStore((s) => s.setDraft);
  const [query, setQuery] = useState('');

  const addFiles = async () => {
    const picked = await api.files.pick();
    await refreshFiles();
    if (picked.length) pushToast({ kind: 'success', title: `${picked.length} dosya eklendi`, body: picked.map((p) => p.name).join(', ') });
  };

  const analyze = async (path: string, name: string) => {
    await setView('chat');
    setDraft(`"${name}" dosyasını analiz et ve özetle: ${path}`);
    pushToast({ kind: 'info', title: 'Falcon’a hazır', body: 'Komutu göndermek için Enter’a bas.' });
  };

  const searchComputer = () => {
    if (!query.trim()) return;
    void setView('chat');
    setDraft(`Bilgisayarımda "${query.trim()}" ile ilgili dosyaları ara ve bulduklarını listele.`);
  };

  const filtered = files.filter((f) => !query || f.name.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')));

  return (
    <section className="panel panel-red flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-white/[0.06] px-5 py-3.5">
        <IconChip size="sm">
          <FileText size={14} />
        </IconChip>
        <h2 className="text-[13.5px] font-semibold text-white/90">Dosyalar</h2>
        <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/40">{files.length}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Field
            placeholder="Bilgisayarda dosya ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchComputer();
            }}
            className="w-[220px] py-1.5 text-[12px]"
          />
          <Button size="sm" variant="ghost" onClick={searchComputer} title="Falcon ile bilgisayarda ara">
            <FolderSearch size={13} />
          </Button>
          <Button size="sm" variant="primary" onClick={() => void addFiles()}>
            <Plus size={13} /> Dosya ekle
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Upload size={18} />}
            title="Dosya yok"
            description="PDF, DOCX, TXT, CSV, görsel veya ses dosyası ekle. Falcon belgeyi okuyabilir, özetleyebilir, çevirebilir ve içindeki soruları yanıtlayabilir."
            action={
              <Button variant="primary" size="sm" onClick={() => void addFiles()}>
                <Plus size={13} /> Dosya ekle
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((file) => {
              const label = ICONS[file.mime] ?? (file.mime.startsWith('image/') ? 'IMG' : (file.name.split('.').pop() ?? 'FILE').toUpperCase().slice(0, 4));
              return (
                <Panel key={file.id} className="group p-3 transition-colors hover:border-falcon-500/25">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-falcon-500/25 bg-falcon-600/15 text-[9.5px] font-bold tracking-wide text-falcon-200">
                      {label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-white/85">{file.name}</p>
                      <p className="truncate text-[10.5px] text-white/30" title={file.path}>
                        {file.path}
                      </p>
                      <p className="mt-1 text-[10px] text-white/25">
                        {formatBytes(file.size)} · {formatRelative(file.addedAt)}
                      </p>
                    </div>
                  </div>
                  {file.summary ? <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-white/40">{file.summary}</p> : null}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" className="flex-1" onClick={() => void analyze(file.path, file.name)}>
                      <Sparkles size={12} /> Analiz et
                    </Button>
                    <button type="button" className="icon-btn h-7 w-7" title="Klasörde göster" onClick={() => void api.system.reveal(file.path)}>
                      <Eye size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn h-7 w-7 hover:text-falcon-300"
                      title="Listeden kaldır"
                      onClick={() => void removeFile(file.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}

        <Panel className="mt-4 flex items-center gap-3 p-4">
          <IconChip>
            <FileSearch size={15} />
          </IconChip>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-white/80">Belgeyi Falcon’a ver, gerisini o halletsin</p>
            <p className="mt-0.5 text-[11px] text-white/35">
              “Bu PDF’i özetle”, “3. sayfadaki tabloyu açıkla”, “İngilizceye çevir ve yeni dosya olarak kaydet” gibi komutlar verebilirsin.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { void setView('chat'); setDraft('Bir dosyayı analiz et ve özetle.'); }}>
            Sohbete git
          </Button>
        </Panel>
      </div>
    </section>
  );
}
