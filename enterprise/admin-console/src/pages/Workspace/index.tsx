import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen, FolderClosed, File, Lock, Edit3, User, ChevronRight, Save, Globe, Briefcase, Bot, ArrowRight, Loader, Search, Code, BookOpen, AlertTriangle, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Card, Badge, Button, PageHeader } from '../../components/ui';
import { useAgents, usePositions, useWorkspaceTree } from '../../hooks/useApi';
import { api } from '../../api/client';
import clsx from 'clsx';

interface WsFile {
  key: string; name: string; layer: 'global' | 'position' | 'personal';
  locked: boolean; size: number; lastModified?: string;
}

const layerConfig = {
  global: { text: 'text-text-muted', border: 'border-text-muted/30', bg: 'bg-surface-dim', icon: '🔒', label: 'Global (IT Locked)' },
  position: { text: 'text-primary', border: 'border-primary/30', bg: 'bg-primary/5', icon: '📋', label: 'Position' },
  personal: { text: 'text-success', border: 'border-success/30', bg: 'bg-success/5', icon: '👤', label: 'Personal' },
};

// M3-style collapsible folder node
function FolderNode({ label, icon, count, children, defaultOpen = false, color = 'text-text-secondary' }: {
  label: string; icon: React.ReactNode; count: number; children: React.ReactNode; defaultOpen?: boolean; color?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
          'hover:bg-dark-hover active:scale-[0.98]',
          color
        )}
      >
        <span className="transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <ChevronRight size={14} />
        </span>
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <span className="text-xs text-text-muted rounded-full bg-surface-container-highest/60 px-2 py-0.5">{count}</span>
      </button>
      <div className={clsx(
        'overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
      )}>
        <div className="ml-4 border-l border-dark-border/40 pl-2 py-1">
          {children}
        </div>
      </div>
    </div>
  );
}

// Sub-folder node (e.g., skills/, memory/)
function SubFolder({ label, files, selectedKey, onSelect }: {
  label: string; files: WsFile[]; selectedKey: string; onSelect: (f: WsFile) => void;
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-text-secondary hover:bg-dark-hover transition-colors"
      >
        {open ? <FolderOpen size={13} className="text-text-muted" /> : <FolderClosed size={13} className="text-text-muted" />}
        <span className="flex-1 text-left font-medium">{label}</span>
        <span className="text-text-muted">{files.length}</span>
      </button>
      {open && (
        <div className="ml-4 py-0.5 space-y-0.5">
          {files.map(f => (
            <FileItem key={f.key} file={f} selected={selectedKey === f.key} onSelect={() => onSelect(f)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Individual file item
function FileItem({ file, selected, onSelect }: { file: WsFile; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        'flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm transition-all duration-200',
        selected
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary'
      )}
    >
      <File size={13} className={selected ? 'text-primary' : 'text-text-muted'} />
      <span className="flex-1 text-left truncate text-xs">{file.name.replace(/^(skills\/|memory\/)/, '')}</span>
      {file.locked && <Lock size={10} className="text-text-muted shrink-0" />}
      <span className="text-[10px] text-text-muted shrink-0">{file.size > 1024 ? `${(file.size / 1024).toFixed(1)}K` : `${file.size}B`}</span>
    </button>
  );
}


export default function Workspace() {
  const [searchParams] = useSearchParams();
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: positions = [] } = usePositions();
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedFileKey, setSelectedFileKey] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [viewMode, setViewMode] = useState<'raw' | 'rendered'>('rendered');
  const [confirmSoul, setConfirmSoul] = useState(false);
  const [pendingFileSwitch, setPendingFileSwitch] = useState<WsFile | null>(null);

  // Set agent from URL param or default
  useEffect(() => {
    const agentParam = searchParams.get('agent');
    if (agentParam && agents.some(a => a.id === agentParam)) {
      setSelectedAgent(agentParam);
    } else if (agents.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0].id);
    }
  }, [agents, selectedAgent, searchParams]);

  const agent = agents.find(a => a.id === selectedAgent);
  const wsAgentType = agent?.deployMode === 'always-on-ecs' ? 'always-on' as const : 'serverless' as const;
  const { data: wsTree, isLoading: treeLoading } = useWorkspaceTree(selectedAgent, wsAgentType);

  const position = positions.find(p => p.id === agent?.positionId);

  // Build structured file list from workspace tree API
  const allFiles: WsFile[] = [];
  if (wsTree) {
    const tree = wsTree as any;
    for (const f of (tree.global?.soul || [])) {
      allFiles.push({ key: f.key, name: f.name, layer: 'global', locked: true, size: f.size, lastModified: f.lastModified });
    }
    for (const f of (tree.global?.skills || [])) {
      allFiles.push({ key: f.key, name: `skills/${f.name}`, layer: 'global', locked: true, size: f.size, lastModified: f.lastModified });
    }
    for (const f of (tree.position?.soul || [])) {
      allFiles.push({ key: f.key, name: f.name, layer: 'position', locked: false, size: f.size, lastModified: f.lastModified });
    }
    for (const f of (tree.position?.skills || [])) {
      allFiles.push({ key: f.key, name: `skills/${f.name}`, layer: 'position', locked: false, size: f.size, lastModified: f.lastModified });
    }
    for (const f of (tree.personal?.files || [])) {
      const isMemory = f.name.includes('MEMORY') || f.name.startsWith('memory/');
      allFiles.push({ key: f.key, name: f.name, layer: 'personal', locked: isMemory, size: f.size, lastModified: f.lastModified });
    }
  }

  // Group files by layer and subfolder
  const globalSoul = allFiles.filter(f => f.layer === 'global' && !f.name.startsWith('skills/'));
  const globalSkills = allFiles.filter(f => f.layer === 'global' && f.name.startsWith('skills/'));
  const posSoul = allFiles.filter(f => f.layer === 'position' && !f.name.startsWith('skills/'));
  const posSkills = allFiles.filter(f => f.layer === 'position' && f.name.startsWith('skills/'));
  const personalCore = allFiles.filter(f => f.layer === 'personal' && !f.name.startsWith('memory/') && !f.name.startsWith('skills/'));
  const personalMemory = allFiles.filter(f => f.layer === 'personal' && f.name.startsWith('memory/'));
  const personalSkills = allFiles.filter(f => f.layer === 'personal' && f.name.startsWith('skills/'));

  // Filter
  const matchFilter = (f: WsFile) => !filterText || f.name.toLowerCase().includes(filterText.toLowerCase());

  const isDirty = isEditing && editContent !== fileContent;

  const loadFile = async (file: WsFile) => {
    setSelectedFileKey(file.key);
    setIsEditing(false);
    setLoading(true);
    try {
      const resp = await api.get<{ key: string; content: string; size: number }>(`/workspace/file?key=${encodeURIComponent(file.key)}`);
      setFileContent(resp.content);
      setEditContent(resp.content);
    } catch {
      setFileContent('(Failed to load file)');
      setEditContent('');
    }
    setLoading(false);
  };

  const handleSelectFile = (file: WsFile) => {
    if (isDirty) {
      setPendingFileSwitch(file);
    } else {
      loadFile(file);
    }
  };

  const handleSave = async () => {
    if (!selectedFileKey || !isDirty) return;
    // Warn before saving SOUL.md — it immediately affects live agent behavior
    if (selectedFileKey.includes('SOUL.md') && !confirmSoul) {
      setConfirmSoul(true);
      return;
    }
    setConfirmSoul(false);
    setSaving(true);
    try {
      await api.put('/workspace/file', { key: selectedFileKey, content: editContent });
      setFileContent(editContent);
      setIsEditing(false);
      setTimeout(() => setSaving(false), 800);
    } catch { setSaving(false); }
  };

  const handleAgentChange = (id: string) => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard and switch agent?')) return;
    setSelectedAgent(id);
    setSelectedFileKey('');
    setFileContent('');
    setEditContent('');
    setIsEditing(false);
  };

  const selectedFile = allFiles.find(f => f.key === selectedFileKey);

  return (
    <div>
      <PageHeader
        title="Workspace Manager"
        description="Three-layer file system — Global (IT locked) → Position → Personal"
        actions={
          <div className="flex gap-2 items-center">
            {selectedFile && selectedFile.name.endsWith('.md') && !isEditing && (
              <Button variant={viewMode === 'rendered' ? 'primary' : 'default'} size="sm" onClick={() => setViewMode(viewMode === 'raw' ? 'rendered' : 'raw')}>
                {viewMode === 'raw' ? <><BookOpen size={14} /> Rendered</> : <><Code size={14} /> Raw</>}
              </Button>
            )}
            {selectedFile && !selectedFile.locked && !isEditing && (
              <Button variant="default" size="sm" onClick={() => setIsEditing(true)}>
                <Edit3 size={14} /> Edit
              </Button>
            )}
            {isEditing && (
              <Button variant="default" size="sm" onClick={() => { setEditContent(fileContent); setIsEditing(false); }}>
                <X size={14} /> Cancel
              </Button>
            )}
            {isEditing && (
              <Button variant="primary" disabled={!isDirty || saving} onClick={handleSave}>
                <Save size={16} />
                {saving ? '✓ Saved' : isDirty ? 'Save *' : 'Save'}
              </Button>
            )}
          </div>
        }
      />

      {/* Agent selector */}
      <Card className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Bot size={20} className="text-primary shrink-0" />
            {agentsLoading ? (
              <Loader size={16} className="animate-spin text-text-muted" />
            ) : (
              <select value={selectedAgent} onChange={e => handleAgentChange(e.target.value)}
                className="rounded-2xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none appearance-none min-w-[280px]">
                <optgroup label="Serverless Agents">
                  {agents.filter(a => a.deployMode !== 'always-on-ecs').map(a => <option key={a.id} value={a.id}>{a.name} ({a.positionName})</option>)}
                </optgroup>
                <optgroup label="Always-on Agents">
                  {agents.filter(a => a.deployMode === 'always-on-ecs').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </optgroup>
              </select>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {agent?.deployMode === 'always-on-ecs' ? (
              <Badge color="success">EFS · Persistent</Badge>
            ) : (
              <Badge color="info">S3 · Sync on session end</Badge>
            )}
            <Badge>🔒 Global {globalSoul.length + globalSkills.length}</Badge>
            <ArrowRight size={14} className="text-text-muted" />
            <Badge color="primary">📋 {position?.name || '?'} {posSoul.length + posSkills.length}</Badge>
            <ArrowRight size={14} className="text-text-muted" />
            <Badge color="success">👤 {agent?.employeeName || 'Shared'} {personalCore.length + personalMemory.length}</Badge>
            <span className="text-text-muted">=</span>
            <Badge color="info">{allFiles.length} files</Badge>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4" style={{ minHeight: '600px' }}>
        {/* File tree — M3 collapsible style */}
        <Card className="lg:col-span-1 overflow-y-auto max-h-[700px]">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-text-primary flex-1">Explorer</h3>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter files..."
              className="w-full rounded-xl border border-dark-border/40 bg-surface-dim py-1.5 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/40 focus:outline-none" />
          </div>

          {treeLoading ? (
            <div className="flex items-center justify-center py-8"><Loader size={20} className="animate-spin text-text-muted" /></div>
          ) : (
            <div className="space-y-1">
              {/* Global */}
              <FolderNode label="Global (IT Locked)" icon={<Globe size={15} />} count={globalSoul.length + globalSkills.length} color="text-text-muted">
                {globalSoul.filter(matchFilter).map(f => (
                  <FileItem key={f.key} file={f} selected={selectedFileKey === f.key} onSelect={() => handleSelectFile(f)} />
                ))}
                <SubFolder label="skills" files={globalSkills.filter(matchFilter)} selectedKey={selectedFileKey} onSelect={handleSelectFile} />
              </FolderNode>

              {/* Position */}
              <FolderNode label={position?.name || 'Position'} icon={<Briefcase size={15} />} count={posSoul.length + posSkills.length} defaultOpen color="text-primary">
                {posSoul.filter(matchFilter).map(f => (
                  <FileItem key={f.key} file={f} selected={selectedFileKey === f.key} onSelect={() => handleSelectFile(f)} />
                ))}
                <SubFolder label="skills" files={posSkills.filter(matchFilter)} selectedKey={selectedFileKey} onSelect={handleSelectFile} />
              </FolderNode>

              {/* Personal */}
              <FolderNode label={agent?.employeeName || 'Personal'} icon={<User size={15} />} count={personalCore.length + personalMemory.length + personalSkills.length} defaultOpen color="text-success">
                {personalCore.filter(matchFilter).map(f => (
                  <FileItem key={f.key} file={f} selected={selectedFileKey === f.key} onSelect={() => handleSelectFile(f)} />
                ))}
                <SubFolder label="memory" files={personalMemory.filter(matchFilter)} selectedKey={selectedFileKey} onSelect={handleSelectFile} />
                <SubFolder label="skills" files={personalSkills.filter(matchFilter)} selectedKey={selectedFileKey} onSelect={handleSelectFile} />
                {personalCore.length === 0 && personalMemory.length === 0 && (
                  <p className="text-[10px] text-text-muted px-2 py-1">No personal files yet</p>
                )}
              </FolderNode>
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-dark-border/30 space-y-1 text-[10px] text-text-muted">
            <div className="flex items-center gap-1.5"><Lock size={10} /> Read-only</div>
            <div className="flex items-center gap-1.5"><Edit3 size={10} /> Editable</div>
          </div>
        </Card>

        {/* Unsaved changes — switch file warning */}
        {pendingFileSwitch && (
          <div className="lg:col-span-3 mb-2">
            <div className="flex items-center gap-3 rounded-xl bg-warning/10 border border-warning/30 px-4 py-3 text-sm">
              <AlertTriangle size={16} className="text-warning shrink-0" />
              <span className="text-text-primary flex-1">You have unsaved changes to <strong>{selectedFile?.name}</strong>. Discard and open {pendingFileSwitch.name}?</span>
              <Button size="sm" variant="danger" onClick={() => { loadFile(pendingFileSwitch); setPendingFileSwitch(null); }}>Discard</Button>
              <Button size="sm" variant="default" onClick={() => setPendingFileSwitch(null)}>Keep editing</Button>
            </div>
          </div>
        )}

        {/* SOUL.md save confirmation */}
        {confirmSoul && (
          <div className="lg:col-span-3 mb-2">
            <div className="flex items-center gap-3 rounded-xl bg-danger/10 border border-danger/30 px-4 py-3 text-sm">
              <AlertTriangle size={16} className="text-danger shrink-0" />
              <span className="text-text-primary flex-1"><strong>Warning:</strong> Saving SOUL.md changes affects live agent behavior immediately. {agent?.deployMode === 'always-on-ecs' ? 'The always-on Fargate container will apply changes within seconds via /admin/refresh.' : 'All new sessions will use the updated SOUL.'}</span>
              <Button size="sm" variant="danger" onClick={async () => {
                setConfirmSoul(false);
                setSaving(true);
                try {
                  await api.put('/workspace/file', { key: selectedFileKey, content: editContent });
                  setFileContent(editContent);
                  setIsEditing(false);
                  setTimeout(() => setSaving(false), 800);
                } catch { setSaving(false); }
              }}>Save anyway</Button>
              <Button size="sm" variant="default" onClick={() => setConfirmSoul(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* File editor / viewer */}
        <Card className="lg:col-span-3">
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader size={24} className="animate-spin text-primary" /></div>
          ) : selectedFile && fileContent ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <File size={18} className={layerConfig[selectedFile.layer].text} />
                  <h3 className="text-lg font-semibold text-text-primary">
                    {selectedFile.name}
                    {isDirty && <span className="ml-1 text-warning text-sm">●</span>}
                  </h3>
                  <Badge color={selectedFile.layer === 'global' ? 'default' : selectedFile.layer === 'position' ? 'primary' : 'success'}>
                    {selectedFile.layer}
                  </Badge>
                  {selectedFile.locked && <Badge color="warning">🔒 Read-only</Badge>}
                  {isEditing && <Badge color="info">✏️ Editing</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span>{selectedFile.size > 1024 ? `${(selectedFile.size / 1024).toFixed(1)} KB` : `${selectedFile.size} B`}</span>
                  {selectedFile.lastModified && <span>{new Date(selectedFile.lastModified).toLocaleString()}</span>}
                </div>
              </div>

              {/* Read view: locked file OR non-editing editable file */}
              {(selectedFile.locked || !isEditing) ? (
                selectedFile.name.endsWith('.md') && viewMode === 'rendered' ? (
                  <div className={clsx('rounded-2xl p-5 min-h-[450px] max-h-[550px] overflow-y-auto border-l-2 prose prose-invert prose-sm max-w-none',
                    '[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2',
                    '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5',
                    '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1',
                    '[&_p]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5',
                    '[&_code]:bg-surface-container-highest [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-lg [&_code]:text-xs',
                    '[&_pre]:bg-surface-container-highest [&_pre]:p-3 [&_pre]:rounded-xl [&_pre]:my-2',
                    '[&_table]:text-xs [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:border-b [&_th]:border-dark-border/30',
                    '[&_td]:px-3 [&_td]:py-1 [&_td]:border-b [&_td]:border-dark-border/20',
                    '[&_strong]:text-text-primary [&_a]:text-primary',
                    '[&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary',
                    layerConfig[selectedFile.layer].bg, layerConfig[selectedFile.layer].border)}>
                    <ReactMarkdown>{fileContent}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className={clsx('rounded-2xl p-4 text-sm text-text-secondary whitespace-pre-wrap font-mono leading-relaxed min-h-[450px] max-h-[550px] overflow-y-auto border-l-2',
                    layerConfig[selectedFile.layer].bg, layerConfig[selectedFile.layer].border)}>
                    {fileContent}
                  </pre>
                )
              ) : (
                /* Edit mode */
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className={clsx('w-full rounded-2xl border border-dark-border/40 p-4 text-sm text-text-primary font-mono leading-relaxed min-h-[450px] max-h-[550px] focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/10 resize-none border-l-2',
                    layerConfig[selectedFile.layer].bg, layerConfig[selectedFile.layer].border)}
                />
              )}

              <div className="mt-4 pt-3 border-t border-dark-border/30 flex items-center justify-between text-xs text-text-muted">
                <span className="font-mono truncate max-w-[60%]" title={`s3://${selectedFile.key}`}>
                  s3://.../{selectedFile.key.split('/').slice(-2).join('/')}
                </span>
                <span>{(isEditing ? editContent : fileContent).split('\n').length} lines · {(isEditing ? editContent : fileContent).length} chars</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted py-20">
              <FolderOpen size={48} className="mb-4 opacity-20" />
              <p className="text-lg mb-2">Select a file from the explorer</p>
              <p className="text-sm">Click any file to view. Use the Edit button to make changes.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
