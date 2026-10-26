import { useState } from 'react';
import {
  ChevronRight,
  FolderKanban,
  FolderOpen,
  ListTodo,
  Plus,
  Sparkles,
  Trash2,
  FileText,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { Button, EmptyState, Field, IconChip, Modal, Panel, TextArea } from '../components/ui';
import { cn, formatRelative } from '../lib/utils';
import { toolIcon } from '../lib/icons';

export function ProjectsView() {
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const files = useStore((s) => s.files);
  const createProject = useStore((s) => s.createProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const updateProject = useStore((s) => s.updateProject);
  const addTask = useStore((s) => s.addTask);
  const toggleTask = useStore((s) => s.toggleTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const setView = useStore((s) => s.setView);
  const selectConversation = useStore((s) => s.selectConversation);
  const pushToast = useStore((s) => s.pushToast);

  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [taskTitle, setTaskTitle] = useState('');

  const selected = projects.find((p) => p.id === selectedId) ?? projects[0] ?? null;
  const projectTasks = selected ? tasks.filter((t) => t.projectId === selected.id) : tasks;
  const projectFiles = selected?.files?.length ? files.filter((f) => selected.files.includes(f.path)) : files.slice(0, 4);

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createProject(name.trim(), description.trim());
    setName('');
    setDescription('');
    setCreating(false);
    pushToast({ kind: 'success', title: 'Proje oluşturuldu' });
  };

  const askFalcon = async () => {
    if (!selected) return;
    await selectConversation(null);
    setView('chat');
    useStore.getState().setDraft(`"${selected.name}" projesi üzerinde çalışalım. ${selected.description ? `Amaç: ${selected.description}. ` : ''}Nereden başlamamı önerirsin?`);
  };

  return (
    <section className="panel panel-red flex min-w-0 flex-1 overflow-hidden">
      {/* sol liste */}
      <div className="flex w-[266px] shrink-0 flex-col border-r border-white/[0.06]">
        <div className="flex items-center gap-2 px-4 pb-2.5 pt-4">
          <IconChip size="sm">
            <FolderKanban size={14} />
          </IconChip>
          <h2 className="flex-1 text-[13.5px] font-semibold text-white/90">Projeler</h2>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus size={13} /> Yeni
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2.5 pb-3">
          {projects.map((project) => {
            const Icon = toolIcon(project.icon === 'code' ? 'file-text' : project.icon === 'note' ? 'notebook-pen' : project.icon === 'calendar' ? 'alarm-clock' : 'folder');
            const active = selected?.id === project.id;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => setSelectedId(project.id)}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-all',
                  active ? 'border border-falcon-500/30 bg-falcon-600/10 shadow-[0_0_26px_-18px_rgba(255,47,47,0.9)]' : 'border border-transparent hover:bg-white/[0.035]',
                )}
              >
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', active ? 'border-falcon-500/40 bg-falcon-600/20 text-falcon-300' : 'border-white/10 bg-white/[0.04] text-white/40')}>
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-white/85">{project.name}</span>
                  <span className="block truncate text-[10.5px] text-white/30">{project.description || 'Proje'}</span>
                </span>
                <ChevronRight size={13} className={cn('shrink-0 transition-colors', active ? 'text-falcon-400' : 'text-white/20')} />
              </button>
            );
          })}
          {projects.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11.5px] text-white/30">Henüz proje yok. İlk projeni oluştur.</p>
          ) : null}
        </div>
        <div className="border-t border-white/[0.06] p-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-white/35">
              <Clock size={11} /> Son kullanılanlar
            </p>
            {projects.slice(0, 2).map((p) => (
              <p key={p.id} className="truncate text-[11px] text-white/45">
                {p.name} · {formatRelative(p.lastOpenedAt ?? p.updatedAt)}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* detay */}
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {!selected ? (
          <EmptyState
            icon={<FolderOpen size={18} />}
            title="Proje seçilmedi"
            description="Soldaki listeden bir proje seç ya da yeni bir çalışma alanı oluştur. Falcon projelerini dosya ve görevlerle birlikte hatırlar."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus size={13} /> Yeni proje
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <IconChip size="lg">
                <FolderOpen size={20} />
              </IconChip>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-[20px] font-bold text-white">{selected.name}</h2>
                <p className="mt-0.5 text-[12px] text-white/40">{selected.description || 'Açıklama yok'} · {formatRelative(selected.updatedAt)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="primary" onClick={() => void askFalcon()}>
                  <Sparkles size={13} /> Falcon ile çalış
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void deleteProject(selected.id);
                    setSelectedId(projects.find((p) => p.id !== selected.id)?.id ?? null);
                  }}
                  title="Projeyi sil"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel className="overflow-hidden">
                <div className="card-head pb-2">
                  <ListTodo size={14} className="text-falcon-400" />
                  <span className="flex-1">Görevler</span>
                  <span className="text-[10.5px] font-normal text-white/30">{projectTasks.filter((t) => !t.done).length} açık</span>
                </div>
                <div className="px-4 pb-3">
                  <div className="mb-2 flex gap-2">
                    <Field
                      placeholder="Görev ekle…"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && taskTitle.trim()) {
                          void addTask(taskTitle.trim());
                          setTaskTitle('');
                        }
                      }}
                      className="py-1.5 text-[12px]"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (taskTitle.trim()) {
                          void addTask(taskTitle.trim());
                          setTaskTitle('');
                        }
                      }}
                    >
                      <Plus size={13} />
                    </Button>
                  </div>
                  <div className="max-h-[220px] space-y-1 overflow-y-auto">
                    {projectTasks.slice(0, 12).map((task) => (
                      <div key={task.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.03]">
                        <button
                          type="button"
                          onClick={() => void toggleTask(task.id, !task.done)}
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                            task.done ? 'border-emerald-400/60 bg-emerald-500/25 text-emerald-300' : 'border-white/20 hover:border-falcon-400/60',
                          )}
                        >
                          {task.done ? <ArrowRight size={10} className="rotate-[-45deg]" /> : null}
                        </button>
                        <span className={cn('flex-1 truncate text-[12px]', task.done ? 'text-white/30 line-through' : 'text-white/70')}>{task.title}</span>
                        {task.priority === 'high' ? <span className="rounded bg-falcon-600/20 px-1.5 py-0.5 text-[9px] text-falcon-200">acil</span> : null}
                        <button
                          type="button"
                          className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100"
                          onClick={() => void deleteTask(task.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    {projectTasks.length === 0 ? <p className="py-3 text-center text-[11.5px] text-white/25">Görev yok.</p> : null}
                  </div>
                </div>
              </Panel>

              <Panel className="overflow-hidden">
                <div className="card-head pb-2">
                  <FileText size={14} className="text-falcon-400" />
                  <span className="flex-1">Dosyalar</span>
                  <button type="button" className="red-link" onClick={() => setView('files')}>
                    Tümü
                  </button>
                </div>
                <div className="space-y-1 px-3 pb-3">
                  {projectFiles.slice(0, 6).map((file) => (
                    <div key={file.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.03]">
                      <FileText size={13} className="shrink-0 text-white/35" />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/65">{file.name}</span>
                      <span className="text-[10px] text-white/25">{formatRelative(file.addedAt)}</span>
                    </div>
                  ))}
                  {projectFiles.length === 0 ? <p className="py-3 text-center text-[11.5px] text-white/25">Dosya yok.</p> : null}
                </div>
              </Panel>
            </div>

            <Panel className="p-4">
              <p className="label mb-2">Falcon için proje notu</p>
              <TextArea
                rows={3}
                defaultValue={selected.description}
                placeholder="Bu projenin amacı, kuralları, hatırlanması gerekenler…"
                onBlur={(e) => {
                  if (e.target.value !== selected.description) {
                    void updateProject(selected.id, { description: e.target.value });
                  }
                }}
                className="text-[12.5px]"
              />
              <p className="mt-2 text-[10.5px] text-white/25">
                Falcon bu projeyi ve ilişkili dosyaları sohbetlerde bağlam olarak kullanır.
              </p>
            </Panel>
          </div>
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Yeni proje"
        description="Proje, dosyalarını ve görevlerini bir arada tutan çalışma alanıdır."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
            <Button variant="primary" onClick={() => void handleCreate()} disabled={!name.trim()}>
              Oluştur
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label mb-1.5 block">Proje adı</label>
            <Field autoFocus placeholder="Örn. YKS Planı" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1.5 block">Açıklama</label>
            <Field placeholder="Kısa açıklama (isteğe bağlı)" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </Modal>
    </section>
  );
}
