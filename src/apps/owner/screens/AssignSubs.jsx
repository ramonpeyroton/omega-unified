import { useState, useEffect } from 'react';
import { ArrowLeft, Search, Phone, Mail, Check, X, UserCheck, MessageCircle, UserX } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

// ── Tools per phase keyword ───────────────────────────────────────────────────
const PHASE_TOOLS = {
  'site prep': 'utility knife, plastic sheeting, tape, floor protection paper, shop vac, safety glasses, dust mask',
  'protection': 'utility knife, plastic sheeting, tape, floor protection paper, shop vac',
  'demo': 'sledgehammer, pry bar, reciprocating saw, shop vac, floor scraper, safety glasses, dust mask, work gloves',
  'demolition': 'sledgehammer, pry bar, reciprocating saw, shop vac, floor scraper, safety glasses, dust mask, work gloves',
  'framing': 'circular saw, drill/driver, nail gun (framing), level, tape measure, speed square, chalk line',
  'rough plumbing': 'pipe cutter, torch, channel-lock pliers, pipe wrench, drill with hole saw, teflon tape',
  'plumbing': 'pipe cutter, torch, channel-lock pliers, pipe wrench, drill with hole saw, teflon tape',
  'rough electrical': 'wire strippers, voltage tester, fish tape, drill with spade bits, staple gun',
  'electrical': 'wire strippers, voltage tester, fish tape, drill with spade bits, staple gun, lineman\'s pliers',
  'waterproof': 'paint roller, trowel, mixing paddle, drill, gloves, respirator, RedGard or Schluter system',
  'drywall': 'drywall screws, screw gun, utility knife, drywall T-square, corner bead, taping knives, mud pan',
  'tile': 'tile saw, notched trowel, grout float, spacers, level, sponge, grout bucket, knee pads',
  'cabinet': 'drill, level, stud finder, tape measure, shims, clamps, cabinet screws',
  'countertop': 'circular saw with diamond blade, jigsaw, silicone, caulk gun, level, clamps',
  'flooring': 'flooring nailer or stapler, pull bar, tapping block, rubber mallet, table saw, tape measure',
  'paint': 'roller frames and covers, brushes, painter\'s tape, drop cloths, paint tray, extension pole',
  'roofing': 'roofing nailer, tin snips, chalk line, utility knife, safety harness, ladder, caulk gun',
  'insulation': 'insulation knife, staple gun, vapor barrier tape, gloves, safety glasses, respirator',
  'cleanup': 'shop vac, broom, mop, dumpster, cleaning supplies, trash bags',
  'fixture': 'adjustable wrench, pliers, caulk gun, level, drill, utility knife',
  'finish': 'caulk gun, painter\'s tape, fine-grit sandpaper, putty knife, touch-up brush',
  'deck': 'circular saw, drill/driver, level, tape measure, framing nailer, joist hanger nails, chalk line',
  'foundation': 'concrete mixer or pump, tamper, rebar cutters, form boards, level, concrete vibrator',
  'excavation': 'shovel, pickaxe, wheelbarrow — machine excavation coordinated separately',
  'hvac': 'tin snips, duct tape, crimper, sheet metal screws, drill, torpedo level',
};

function getToolsForPhase(phaseName) {
  const lower = (phaseName || '').toLowerCase();
  for (const [key, tools] of Object.entries(PHASE_TOOLS)) {
    if (lower.includes(key)) return tools;
  }
  return 'standard hand tools, drill, level, tape measure, safety glasses, work gloves';
}

// ── WhatsApp message builder ──────────────────────────────────────────────────
function buildSubWhatsApp(subPhone, subName, phaseName, tasks, jobAddress, startDate, startTime) {
  const phone = (subPhone || '').replace(/\D/g, '');
  if (!phone) return null;
  const taskList = (tasks || [])
    .filter((t) => !t.startsWith('__'))
    .map((t) => `• ${t}`)
    .join('\n');
  const tools = getToolsForPhase(phaseName);
  const toolList = tools.split(',').map((t) => `• ${t.trim()}`).join('\n');
  const dateStr = startDate ? `📅 Start: ${startDate}${startTime ? ` at ${startTime}` : ''}` : '';

  const msg = `Hi ${subName}! 👷

You've been assigned to a project with Omega Development.

📍 Location: ${jobAddress}${dateStr ? `\n${dateStr}` : ''}
🔨 Phase: ${phaseName}

Your scope of work:
${taskList || '• Tasks will be provided on site'}

🧰 Tools to bring:
${toolList}

Please confirm your availability by replying.
Thank you for being part of the Omega team! 🏗️

— Omega Development
📞 203-451-4846
🌐 omeganyct.com`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Confirm Unassign Dialog ───────────────────────────────────────────────────
function ConfirmUnassign({ subName, phaseName, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <UserX className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="text-center font-bold text-omega-charcoal mb-2">Remove Assignment?</p>
        <p className="text-center text-sm text-omega-stone mb-6">
          Remove <strong>{subName}</strong> from <strong>{phaseName}</strong>?
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate font-semibold text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600">Remove</button>
        </div>
      </div>
    </div>
  );
}

export default function AssignSubs({ job, phases, onNavigate }) {
  const [subs, setSubs] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [toast, setToast] = useState(null);
  const [selectedPhase, setSelectedPhase] = useState(phases[0]?.phase || '');
  const [confirmUnassign, setConfirmUnassign] = useState(null); // { phase, subName }

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [{ data: subData }, { data: existingAssignments }] = await Promise.all([
      supabase.from('subcontractors').select('*').order('name'),
      supabase.from('job_subs').select('*').eq('job_id', job.id),
    ]);
    setSubs(subData || []);
    const map = {};
    (existingAssignments || []).forEach((a) => { map[a.phase] = a; });
    setAssignments(map);
    setLoading(false);
  }

  async function assignSub(phase, sub) {
    setSaving((p) => ({ ...p, [phase]: true }));
    try {
      const existing = assignments[phase];
      const data = {
        job_id: job.id,
        phase,
        phase_index: phases.find((p) => p.phase === phase)?.phase_index ?? 0,
        sub_name: sub.name,
        sub_phone: sub.phone,
        message_sent: false,
      };
      if (existing) {
        const { data: updated } = await supabase.from('job_subs').update(data).eq('id', existing.id).select().single();
        setAssignments((p) => ({ ...p, [phase]: updated }));
      } else {
        const { data: created } = await supabase.from('job_subs').insert([data]).select().single();
        setAssignments((p) => ({ ...p, [phase]: created }));
      }
      setToast({ type: 'success', message: `${sub.name} assigned to ${phase}` });
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to assign' });
    } finally {
      setSaving((p) => ({ ...p, [phase]: false }));
    }
  }

  async function unassignSub(phase) {
    const existing = assignments[phase];
    if (!existing) return;
    setSaving((p) => ({ ...p, [phase]: true }));
    try {
      await supabase.from('job_subs').delete().eq('id', existing.id);
      setAssignments((p) => {
        const next = { ...p };
        delete next[phase];
        return next;
      });
      setToast({ type: 'success', message: `Removed from ${phase}` });
    } catch {
      setToast({ type: 'error', message: 'Failed to unassign' });
    } finally {
      setSaving((p) => ({ ...p, [phase]: false }));
      setConfirmUnassign(null);
    }
  }

  const filteredSubs = subs.filter((s) =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.specialty?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmUnassign && (
        <ConfirmUnassign
          subName={confirmUnassign.subName}
          phaseName={confirmUnassign.phase}
          onConfirm={() => unassignSub(confirmUnassign.phase)}
          onCancel={() => setConfirmUnassign(null)}
        />
      )}

      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
        <button onClick={() => onNavigate('job-detail')} className="p-2 rounded-xl border border-gray-200 text-omega-stone hover:text-omega-charcoal transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-omega-charcoal">Assign Subcontractors</h1>
          <p className="text-xs text-omega-stone">{job.client_name} · {job.service}</p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Phase list */}
        <div className="w-56 border-r border-gray-200 flex-shrink-0 overflow-y-auto bg-omega-cloud p-3">
          <p className="text-xs font-semibold text-omega-stone uppercase tracking-wider px-2 mb-2">Phases</p>
          {phases.map((p) => {
            const assigned = assignments[p.phase];
            return (
              <button key={p.phase} onClick={() => setSelectedPhase(p.phase)}
                className={`w-full text-left px-3 py-2.5 rounded-xl mb-1 transition-all ${selectedPhase === p.phase ? 'bg-omega-orange text-white' : 'hover:bg-white text-omega-charcoal'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{p.phase}</span>
                  {assigned && <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />}
                </div>
                {assigned && <p className={`text-xs mt-0.5 truncate ${selectedPhase === p.phase ? 'text-white/70' : 'text-omega-stone'}`}>{assigned.sub_name}</p>}
              </button>
            );
          })}
        </div>

        {/* Sub picker */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-omega-charcoal">{selectedPhase || 'Select a phase'}</h2>
                {assignments[selectedPhase] && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-omega-success font-medium">
                      ✓ Assigned: {assignments[selectedPhase].sub_name}
                    </span>
                    <button
                      onClick={() => setConfirmUnassign({ phase: selectedPhase, subName: assignments[selectedPhase].sub_name })}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
                      <X className="w-3 h-3" />Unassign
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or specialty..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange transition-colors bg-white" />
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><LoadingSpinner /></div>
            ) : (
              <div className="space-y-2">
                {filteredSubs.map((sub) => {
                  const isAssigned = assignments[selectedPhase]?.sub_name === sub.name;
                  const phase = phases.find((p) => p.phase === selectedPhase);
                  const waUrl = isAssigned
                    ? buildSubWhatsApp(sub.phone, sub.name, selectedPhase, phase?.tasks, job.address)
                    : null;

                  return (
                    <div key={sub.id} className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${isAssigned ? 'border-omega-success bg-green-50' : 'border-gray-200 bg-white hover:border-omega-orange/40'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-omega-charcoal text-sm">{sub.name}</p>
                          {sub.specialty && <span className="text-xs px-2 py-0.5 rounded-full bg-omega-pale text-omega-orange font-medium">{sub.specialty}</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {sub.phone && <a href={`tel:${sub.phone}`} className="flex items-center gap-1 text-xs text-omega-stone hover:text-omega-orange transition-colors"><Phone className="w-3 h-3" />{sub.phone}</a>}
                          {sub.email && <a href={`mailto:${sub.email}`} className="flex items-center gap-1 text-xs text-omega-stone hover:text-omega-orange transition-colors"><Mail className="w-3 h-3" />{sub.email}</a>}
                        </div>
                        {isAssigned && waUrl && (
                          <a href={waUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors">
                            <MessageCircle className="w-3.5 h-3.5" />
                            WhatsApp Sub
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isAssigned && (
                          <button
                            onClick={() => setConfirmUnassign({ phase: selectedPhase, subName: sub.name })}
                            className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                            title="Unassign">
                            <UserX className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => selectedPhase && assignSub(selectedPhase, sub)}
                          disabled={!selectedPhase || saving[selectedPhase]}
                          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${isAssigned ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-omega-orange text-white hover:bg-omega-dark disabled:opacity-50'}`}>
                          {saving[selectedPhase]
                            ? <LoadingSpinner size={14} color="text-white" />
                            : isAssigned
                              ? <><Check className="w-4 h-4 inline" /> Assigned</>
                              : 'Assign'}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filteredSubs.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-omega-stone text-sm">No subcontractors found</p>
                    <button onClick={() => onNavigate('subcontractors')} className="mt-2 text-xs text-omega-orange font-semibold hover:underline">
                      Add a subcontractor
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
