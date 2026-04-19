import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, CheckSquare, Square, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

export default function PunchList({ job, onNavigate, darkMode }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { loadItems(); }, []);

  async function loadItems() {
    const { data } = await supabase.from('punch_list').select('*').eq('job_id', job.id).order('created_at');
    setItems(data || []);
    setLoading(false);
  }

  async function addItem() {
    if (!newTask.trim()) return;
    setAdding(true);
    const { data } = await supabase.from('punch_list').insert([{ job_id: job.id, task: newTask.trim(), completed: false, created_at: new Date().toISOString() }]).select().single();
    if (data) setItems((p) => [...p, data]);
    setNewTask('');
    setAdding(false);
  }

  async function toggleItem(item) {
    const { data } = await supabase.from('punch_list').update({ completed: !item.completed }).eq('id', item.id).select().single();
    if (data) setItems((p) => p.map((i) => (i.id === item.id ? data : i)));
  }

  async function deleteItem(id) {
    await supabase.from('punch_list').delete().eq('id', id);
    setItems((p) => p.filter((i) => i.id !== id));
  }

  const done = items.filter((i) => i.completed).length;

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-gray-900' : 'bg-omega-cloud'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="bg-omega-charcoal px-5 pt-12 pb-5">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => onNavigate('phase-board')} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-omega-fog text-xs">{job.client_name}</p>
            <h1 className="text-white font-bold text-lg">Punch List</h1>
          </div>
        </div>
        <p className="text-omega-stone text-xs pl-11">{done}/{items.length} completed</p>
      </div>

      <div className="px-4 py-5">
        {/* Add new */}
        <div className="flex gap-2 mb-5">
          <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="Add punch list item..."
            className={`flex-1 px-4 py-3 rounded-xl border text-sm focus:outline-none focus:border-omega-orange transition-colors ${darkMode ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-400' : 'bg-white border-gray-200 text-omega-charcoal placeholder-omega-fog'}`} />
          <button onClick={addItem} disabled={adding} className="p-3 rounded-xl bg-omega-orange text-white hover:bg-omega-dark transition-colors">
            {adding ? <LoadingSpinner size={16} color="text-white" /> : <Plus className="w-5 h-5" />}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <CheckSquare className="w-12 h-12 text-omega-fog mx-auto mb-3" />
            <p className={`font-semibold ${darkMode ? 'text-white' : 'text-omega-charcoal'}`}>No punch list items</p>
            <p className="text-sm text-omega-stone mt-1">Add items above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${item.completed ? 'bg-green-50 border-green-200' : darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                <button onClick={() => toggleItem(item)}>
                  {item.completed ? <CheckSquare className="w-5 h-5 text-omega-success" /> : <Square className="w-5 h-5 text-omega-fog" />}
                </button>
                <span className={`flex-1 text-sm ${item.completed ? 'line-through text-omega-stone' : darkMode ? 'text-white' : 'text-omega-charcoal'}`}>{item.task}</span>
                <button onClick={() => deleteItem(item.id)} className="p-1.5 rounded-lg text-omega-fog hover:text-omega-danger transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
