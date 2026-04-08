import { Building2, Users, Bot, ChevronRight, ChevronDown, Zap, TrendingUp, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Card, Badge, PageHeader, StatCard, Button, Modal, Input, Select } from '../../components/ui';
import { useDepartments, useEmployees, useAgents, useBindings, usePositions, useCreateDepartment, useUpdateDepartment, useDeleteDepartment } from '../../hooks/useApi';
import { CHANNEL_LABELS } from '../../types';
import type { Department, ChannelType } from '../../types';
import clsx from 'clsx';

interface TreeDept extends Department {
  children: TreeDept[];
  employeeCount: number;
}

function buildTree(depts: Department[], employees: { departmentId: string }[]): TreeDept[] {
  const empCount: Record<string, number> = {};
  employees.forEach(e => { empCount[e.departmentId] = (empCount[e.departmentId] || 0) + 1; });
  const map = new Map<string, TreeDept>();
  depts.forEach(d => map.set(d.id, { ...d, children: [], employeeCount: empCount[d.id] || 0 }));
  const roots: TreeDept[] = [];
  map.forEach(d => {
    if (d.parentId && map.has(d.parentId)) map.get(d.parentId)!.children.push(d);
    else if (!d.parentId) roots.push(d);
  });
  return roots;
}

function DeptNode({ dept, depth = 0 }: { dept: TreeDept; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = dept.children.length > 0;
  return (
    <div>
      <div
        className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-dark-hover transition-colors cursor-pointer', depth === 0 && 'bg-dark-bg/50')}
        style={{ marginLeft: depth * 24 }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        {hasChildren ? (open ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />) : <span className="w-3.5" />}
        <Building2 size={14} className={depth === 0 ? 'text-primary' : 'text-text-muted'} />
        <span className={clsx('text-sm', depth === 0 ? 'font-medium text-text-primary' : 'text-text-secondary')}>{dept.name}</span>
        <span className="text-xs text-text-muted ml-auto">{dept.headCount}</span>
      </div>
      {open && dept.children.map(child => <DeptNode key={child.id} dept={child} depth={depth + 1} />)}
    </div>
  );
}

// Color palette for department cards
const DEPT_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

export default function DeptTree() {
  const { data: departments = [] } = useDepartments();
  const { data: employees = [] } = useEmployees();
  const { data: agents = [] } = useAgents();
  const { data: bindings = [] } = useBindings();
  const { data: positions = [] } = usePositions();
  const createDept = useCreateDepartment();
  const updateDept = useUpdateDepartment();
  const deleteDept = useDeleteDepartment();
  const [view, setView] = useState<'cards' | 'tree'>('cards');
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  // CRUD modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [formName, setFormName] = useState('');
  const [formParent, setFormParent] = useState('');
  const [formHeadCount, setFormHeadCount] = useState('');

  const deptOptions = departments.map(d => ({ label: d.name, value: d.id }));
  const parentOptions = [{ label: '(Top-level — no parent)', value: '' }, ...deptOptions];

  const openCreate = () => { setFormName(''); setFormParent(''); setFormHeadCount(''); setShowCreate(true); };
  const openEdit = (dept: Department, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(dept);
    setFormName(dept.name);
    setFormParent(dept.parentId || '');
    setFormHeadCount(String(dept.headCount || ''));
  };
  const openDelete = (dept: Department, e: React.MouseEvent) => { e.stopPropagation(); setDeleting(dept); setDeleteError(''); };

  const handleCreate = () => {
    if (!formName.trim()) return;
    createDept.mutate({ name: formName.trim(), parentId: formParent || undefined, headCount: Number(formHeadCount) || 0 }, {
      onSuccess: () => setShowCreate(false),
    });
  };
  const handleEdit = () => {
    if (!editing || !formName.trim()) return;
    updateDept.mutate({ id: editing.id, name: formName.trim(), parentId: formParent || undefined, headCount: Number(formHeadCount) || 0 }, {
      onSuccess: () => setEditing(null),
    });
  };
  const handleDelete = () => {
    if (!deleting) return;
    setDeleteError('');
    deleteDept.mutate(deleting.id, {
      onSuccess: () => { setDeleting(null); setSelectedDept(null); },
      onError: (err: any) => {
        const msg = err?.response?.data?.message || err?.message || 'Delete failed';
        setDeleteError(msg);
      },
    });
  };

  const tree = buildTree(departments, employees);
  const topLevel = departments.filter(d => !d.parentId);
  const totalEmployees = employees.length;
  const boundEmployees = employees.filter(e => e.agentId).length;
  const coveragePercent = totalEmployees > 0 ? Math.round((boundEmployees / totalEmployees) * 100) : 0;

  // Build a map of top-level dept → all descendant dept IDs (including self)
  const deptDescendants = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    topLevel.forEach(d => {
      const ids = new Set<string>([d.id]);
      // BFS to find all children
      const queue = [d.id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        departments.filter(c => c.parentId === current).forEach(child => {
          ids.add(child.id);
          queue.push(child.id);
        });
      }
      map[d.id] = ids;
    });
    return map;
  }, [departments, topLevel]);

  // Per-department stats
  const deptStats = topLevel.map((dept, idx) => {
    const childIds = deptDescendants[dept.id] || new Set([dept.id]);
    const deptEmps = employees.filter(e => childIds.has(e.departmentId));
    const deptAgents = agents.filter(a => {
      const pos = positions.find(p => p.id === a.positionId);
      return pos ? childIds.has(pos.departmentId) : false;
    });
    const deptBindings = bindings.filter(b => deptEmps.some(e => e.id === b.employeeId));
    const bound = deptEmps.filter(e => e.agentId).length;
    const coverage = deptEmps.length > 0 ? Math.round((bound / deptEmps.length) * 100) : 0;
    const deptPositions = positions.filter(p => childIds.has(p.departmentId));
    const channels = new Set<string>();
    deptEmps.forEach(e => (e.channels || []).forEach(c => channels.add(c)));

    return {
      ...dept,
      employees: deptEmps,
      agentCount: deptAgents.length,
      bindingCount: deptBindings.length,
      bound,
      unbound: deptEmps.length - bound,
      coverage,
      positions: deptPositions,
      channels: Array.from(channels),
      color: DEPT_COLORS[idx % DEPT_COLORS.length],
    };
  });

  const sel = selectedDept ? deptStats.find(d => d.id === selectedDept) : null;

  return (
    <div>
      <PageHeader
        title="Department Overview"
        description="Organization structure, headcount, and AI agent coverage by department"
        actions={
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={openCreate}><Plus size={14} /> Add Department</Button>
            <Button variant={view === 'cards' ? 'default' : 'ghost'} size="sm" onClick={() => setView('cards')}>Cards</Button>
            <Button variant={view === 'tree' ? 'default' : 'ghost'} size="sm" onClick={() => setView('tree')}>Tree</Button>
          </div>
        }
      />

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mb-6">
        <StatCard title="Departments" value={topLevel.length} icon={<Building2 size={22} />} color="primary" />
        <StatCard title="Positions" value={positions.length} icon={<Users size={22} />} color="info" />
        <StatCard title="Employees" value={totalEmployees} icon={<Users size={22} />} color="success" />
        <StatCard title="Active Agents" value={agents.filter(a => a.status === 'active').length} icon={<Bot size={22} />} color="cyan" />
        <StatCard title="Agent Coverage" value={`${coveragePercent}%`} icon={<TrendingUp size={22} />} color={coveragePercent === 100 ? 'success' : coveragePercent >= 80 ? 'info' : 'warning'} />
      </div>

      {view === 'cards' ? (
        <>
          {/* Department Cards Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 mb-6">
            {deptStats.map(dept => (
              <div
                key={dept.id}
                onClick={() => setSelectedDept(dept.id)}
                className="rounded-xl border border-dark-border bg-dark-card p-5 hover:border-primary/40 transition-all cursor-pointer group"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: dept.color + '20' }}>
                      <Building2 size={20} style={{ color: dept.color }} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary group-hover:text-primary-light transition-colors">{dept.name}</h3>
                      <p className="text-xs text-text-muted">{dept.positions.length} position{dept.positions.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={e => openEdit(dept, e)} className="p-1.5 rounded hover:bg-dark-hover text-text-muted hover:text-text-primary"><Pencil size={13} /></button>
                    <button onClick={e => openDelete(dept, e)} className="p-1.5 rounded hover:bg-dark-hover text-text-muted hover:text-danger"><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center">
                    <p className="text-lg font-semibold text-text-primary">{dept.headCount}</p>
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">Headcount</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-text-primary">{dept.agentCount}</p>
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">Agents</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-text-primary">{dept.bindingCount}</p>
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">Bindings</p>
                  </div>
                </div>

                {/* Coverage Bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-muted">Agent Coverage</span>
                    <span className={dept.coverage === 100 ? 'text-green-400' : dept.coverage >= 80 ? 'text-blue-400' : 'text-amber-400'}>{dept.coverage}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-dark-bg overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${dept.coverage}%`, backgroundColor: dept.coverage === 100 ? '#10b981' : dept.coverage >= 80 ? '#06b6d4' : '#f59e0b' }}
                    />
                  </div>
                </div>

                {/* Channels */}
                {(dept.channels || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(dept.channels || []).map(c => (
                      <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-dark-bg text-text-muted">{CHANNEL_LABELS[c as ChannelType]}</span>
                    ))}
                  </div>
                )}

                {/* Unbound Warning */}
                {dept.unbound > 0 && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-400">
                    <Zap size={12} />
                    <span>{dept.unbound} employee{dept.unbound !== 1 ? 's' : ''} without agent</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Coverage Summary Bar */}
          <Card>
            <h3 className="text-sm font-semibold text-text-primary mb-4">Coverage by Department</h3>
            <div className="space-y-3">
              {deptStats.sort((a, b) => b.coverage - a.coverage).map(dept => (
                <div key={dept.id} className="flex items-center gap-4">
                  <span className="text-sm text-text-secondary w-40 truncate">{dept.name}</span>
                  <div className="flex-1 h-3 rounded-full bg-dark-bg overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${dept.coverage}%`, backgroundColor: dept.color }}
                    />
                  </div>
                  <span className="text-xs text-text-muted w-20 text-right">{dept.bound}/{dept.employees.length} ({dept.coverage}%)</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        /* Tree View */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-text-primary mb-4">ACME Corp</h3>
            <div className="space-y-0.5">
              {tree.map(dept => <DeptNode key={dept.id} dept={dept} />)}
            </div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold text-text-primary mb-4">Summary</h3>
            <div className="space-y-3">
              {[
                ['Total Departments', departments.length],
                ['Top-level', topLevel.length],
                ['Total Headcount', topLevel.reduce((s, d) => s + d.headCount, 0)],
                ['Employees in System', employees.length],
                ['Agents Active', agents.filter(a => a.status === 'active').length],
                ['Agent Coverage', `${coveragePercent}%`],
              ].map(([label, val]) => (
                <div key={String(label)} className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                  <span className="text-sm text-text-muted">{label}</span>
                  <span className="text-sm font-medium">{val}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Create Department Modal */}
      <Modal open={showCreate} title="Create Department" onClose={() => setShowCreate(false)} footer={
        <><Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
        <Button variant="primary" onClick={handleCreate} disabled={!formName.trim() || createDept.isPending}>
          {createDept.isPending ? 'Creating…' : 'Create'}
        </Button></>
      }>
        <div className="space-y-4">
          <Input label="Name" value={formName} onChange={v => setFormName(v)} placeholder="e.g. Platform Team" />
          <Select label="Parent Department" value={formParent} onChange={v => setFormParent(v)} options={parentOptions} />
          <Input label="Headcount" type="number" value={formHeadCount} onChange={v => setFormHeadCount(v)} placeholder="0" />
        </div>
      </Modal>

      {/* Edit Department Modal */}
      <Modal open={!!editing} title={editing ? `Edit: ${editing.name}` : ''} onClose={() => setEditing(null)} footer={
        <><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        <Button variant="primary" onClick={handleEdit} disabled={!formName.trim() || updateDept.isPending}>
          {updateDept.isPending ? 'Saving…' : 'Save'}
        </Button></>
      }>
        <div className="space-y-4">
          <Input label="Name" value={formName} onChange={v => setFormName(v)} />
          <Select label="Parent Department" value={formParent} onChange={v => setFormParent(v)}
            options={parentOptions.filter(o => !editing || o.value !== editing.id)} />
          <Input label="Headcount" type="number" value={formHeadCount} onChange={v => setFormHeadCount(v)} />
        </div>
      </Modal>

      {/* Delete Department Modal */}
      <Modal open={!!deleting} title="Delete Department" onClose={() => setDeleting(null)} footer={
        <><Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
        <Button variant="danger" onClick={handleDelete} disabled={deleteDept.isPending || !!deleteError}>
          {deleteDept.isPending ? 'Deleting…' : 'Delete'}
        </Button></>
      }>
        <div className="space-y-3">
          <p className="text-sm text-text-primary">
            Are you sure you want to delete <strong>{deleting?.name}</strong>?
          </p>
          {deleteError ? (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
              <AlertTriangle size={16} className="text-danger mt-0.5 shrink-0" />
              <p className="text-sm text-danger">{deleteError}</p>
            </div>
          ) : (
            <p className="text-xs text-text-muted">This cannot be undone. Employees and sub-departments must be reassigned first.</p>
          )}
        </div>
      </Modal>

      {/* Department Detail Drawer */}
      {sel && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedDept(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg bg-dark-card border-l border-dark-border overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: sel.color + '20' }}>
                    <Building2 size={20} style={{ color: sel.color }} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">{sel.name}</h2>
                    <p className="text-xs text-text-muted">{sel.positions.length} positions · {sel.headCount} headcount</p>
                  </div>
                </div>
                <button onClick={() => setSelectedDept(null)} className="text-text-muted hover:text-text-primary text-xl">×</button>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'Employees', value: sel.employees.length, color: 'text-text-primary' },
                  { label: 'Agents', value: sel.agentCount, color: 'text-blue-400' },
                  { label: 'Bound', value: sel.bound, color: 'text-green-400' },
                  { label: 'Unbound', value: sel.unbound, color: sel.unbound > 0 ? 'text-amber-400' : 'text-green-400' },
                ].map(kpi => (
                  <div key={kpi.label} className="rounded-lg bg-dark-bg p-3 text-center">
                    <p className={`text-xl font-semibold ${kpi.color}`}>{kpi.value}</p>
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">{kpi.label}</p>
                  </div>
                ))}
              </div>

              {/* Coverage */}
              <div className="mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-text-muted">Agent Coverage</span>
                  <span className="font-medium">{sel.coverage}%</span>
                </div>
                <div className="h-3 rounded-full bg-dark-bg overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${sel.coverage}%`, backgroundColor: sel.color }} />
                </div>
              </div>

              {/* Positions */}
              <div className="mb-6">
                <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Positions ({sel.positions.length})</h3>
                <div className="space-y-2">
                  {sel.positions.map(p => {
                    const posEmps = sel.employees.filter(e => e.positionId === p.id);
                    const posBound = posEmps.filter(e => e.agentId).length;
                    return (
                      <div key={p.id} className="flex items-center justify-between rounded-lg bg-dark-bg px-3 py-2.5">
                        <span className="text-sm font-medium">{p.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-muted">{posEmps.length} members</span>
                          <Badge color={posBound === posEmps.length ? 'success' : 'warning'}>{posBound}/{posEmps.length}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Employees */}
              <div>
                <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Employees ({sel.employees.length})</h3>
                <div className="space-y-1.5">
                  {sel.employees.map(e => {
                    const agent = agents.find(a => a.id === e.agentId);
                    return (
                      <div key={e.id} className="flex items-center justify-between rounded-lg bg-dark-bg px-3 py-2">
                        <div>
                          <span className="text-sm">{e.name}</span>
                          <span className="text-xs text-text-muted ml-2">{e.positionName}</span>
                        </div>
                        {agent ? (
                          <div className="flex items-center gap-1.5">
                            <Bot size={12} className="text-green-400" />
                            <span className="text-xs text-text-secondary">{agent.name.split(' - ')[0]}</span>
                          </div>
                        ) : (
                          <Badge color="warning">Unbound</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Channels */}
              {(sel.channels || []).length > 0 && (
                <div className="mt-6">
                  <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Active Channels</h3>
                  <div className="flex flex-wrap gap-2">
                    {(sel.channels || []).map(c => <Badge key={c} color="info">{CHANNEL_LABELS[c as ChannelType]}</Badge>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
