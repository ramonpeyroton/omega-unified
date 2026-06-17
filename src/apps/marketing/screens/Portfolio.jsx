// Portfolio gallery — marketing's window into every jobsite photo the
// company has captured. Aggregates the two real photo sources:
//   • jobs.cover_photo_url        (the card cover)
//   • job_documents folder='daily_logs'  (photos posted in the chat — ~990)
// grouped by project and filterable by service type and status. Phase
// photos (migration 003) are effectively unused (≈5 rows) so we skip them.
//
// Read-only, no money — fits the marketing role. Ramon browses by
// project, opens a project to see every photo, and downloads what he
// wants for social / the website / Houzz.

import { useEffect, useMemo, useState } from 'react';
import { Images, Search, X, Download, MapPin, Loader2, FolderOpen } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { supabase } from '../../../shared/lib/supabase';
import { SERVICES, serviceBadgeLabel, parseJobServices } from '../../../shared/data/services';

const STATUS_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'active',    label: 'In Progress' },
];
const ACTIVE_STATUSES = new Set(['in_progress', 'in-progress', 'awaiting_kickoff', 'contract_signed']);

export default function Portfolio({ user }) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openProject, setOpenProject] = useState(null);
  const [viewer, setViewer] = useState(null); // { url, title }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [{ data: jobs, error: jErr }, { data: docs, error: dErr }] = await Promise.all([
        supabase
          .from('jobs')
          .select('id, client_name, service, pipeline_status, cover_photo_url, address, city, updated_at')
          .order('updated_at', { ascending: false }),
        supabase
          .from('job_documents')
          .select('job_id, photo_url, title, created_at')
          .eq('folder', 'daily_logs')
          .order('created_at', { ascending: false })
          .limit(3000),
      ]);
      if (jErr) throw jErr;
      if (dErr) throw dErr;

      // Group daily-log photos by job.
      const photosByJob = new Map();
      for (const d of docs || []) {
        if (!d.photo_url || isPdf(d.photo_url)) continue;
        if (!photosByJob.has(d.job_id)) photosByJob.set(d.job_id, []);
        photosByJob.get(d.job_id).push({ url: d.photo_url, title: d.title || '', createdAt: d.created_at });
      }

      // Build one project per job that has at least one usable photo
      // (cover counts). Cover goes first so the card has a hero image.
      const list = [];
      for (const job of jobs || []) {
        const logPhotos = photosByJob.get(job.id) || [];
        const photos = [];
        if (job.cover_photo_url && !isPdf(job.cover_photo_url)) {
          photos.push({ url: job.cover_photo_url, title: 'Cover', createdAt: job.updated_at });
        }
        photos.push(...logPhotos);
        if (photos.length === 0) continue;
        list.push({ job, photos, count: photos.length });
      }
      // Most-photographed projects first — they make the best showcase.
      list.sort((a, b) => b.count - a.count);
      setProjects(list);
    } catch (err) {
      setError(err.message || 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }

  // Services that actually have projects with photos — drives the chips
  // so we don't show empty filters.
  const availableServices = useMemo(() => {
    const ids = new Set();
    for (const p of projects) parseJobServices(p.job.service).forEach((id) => ids.add(id));
    return SERVICES.filter((s) => ids.has(s.id));
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (serviceFilter !== 'all' && !parseJobServices(p.job.service).includes(serviceFilter)) return false;
      if (statusFilter === 'completed' && p.job.pipeline_status !== 'completed') return false;
      if (statusFilter === 'active' && !ACTIVE_STATUSES.has(p.job.pipeline_status)) return false;
      if (q) {
        const hay = `${p.job.client_name || ''} ${p.job.address || ''} ${p.job.city || ''} ${serviceBadgeLabel(p.job.service)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, serviceFilter, statusFilter, query]);

  const totalPhotos = useMemo(() => filtered.reduce((s, p) => s + p.count, 0), [filtered]);

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <PageHeader
        icon={Images}
        title="Portfolio"
        subtitle={loading ? 'Loading photos…' : `${filtered.length} project${filtered.length === 1 ? '' : 's'} · ${totalPhotos} photos`}
      />

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, address or service…"
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 bg-white text-[15px] focus:outline-none focus:border-omega-orange"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((s) => (
            <Chip key={s.id} active={statusFilter === s.id} onClick={() => setStatusFilter(s.id)}>{s.label}</Chip>
          ))}
          <span className="w-px h-5 bg-gray-200 mx-1" />
          <Chip active={serviceFilter === 'all'} onClick={() => setServiceFilter('all')}>All services</Chip>
          {availableServices.map((s) => (
            <Chip key={s.id} active={serviceFilter === s.id} onClick={() => setServiceFilter(s.id)}>
              {serviceBadgeLabel(s.id)}
            </Chip>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-omega-stone">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading photos…
        </div>
      ) : error ? (
        <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-omega-stone gap-2">
          <FolderOpen className="w-8 h-8" />
          <p className="text-sm">No projects match these filters.</p>
        </div>
      ) : (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((p) => (
            <ProjectCard key={p.job.id} project={p} onOpen={() => setOpenProject(p)} />
          ))}
        </div>
      )}

      {openProject && (
        <ProjectModal
          project={openProject}
          onClose={() => setOpenProject(null)}
          onViewPhoto={(photo) => setViewer(photo)}
        />
      )}
      {viewer && <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
        active ? 'bg-omega-orange text-white border-omega-orange' : 'bg-white text-omega-stone border-gray-200 hover:border-omega-orange'
      }`}
    >
      {children}
    </button>
  );
}

function ProjectCard({ project, onOpen }) {
  const { job, photos, count } = project;
  return (
    <button
      onClick={onOpen}
      className="group text-left bg-white rounded-2xl border border-gray-200 overflow-hidden hover:border-omega-orange hover:shadow-card transition-all"
    >
      <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
        <img
          src={photos[0]?.url}
          alt={job.client_name || 'Project'}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.opacity = '0'; }}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-bold backdrop-blur-sm">
          {count} photo{count === 1 ? '' : 's'}
        </span>
        {job.service && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-omega-orange text-white text-[10px] font-bold uppercase tracking-wide">
            {serviceBadgeLabel(job.service)}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-bold text-omega-charcoal truncate">{job.client_name || 'Project'}</p>
        <p className="text-[11px] text-omega-stone truncate flex items-center gap-1 mt-0.5">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          {job.city || job.address || '—'}
        </p>
      </div>
    </button>
  );
}

function ProjectModal({ project, onClose, onViewPhoto }) {
  const { job, photos } = project;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-4xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-omega-charcoal truncate">{job.client_name || 'Project'}</h3>
            <p className="text-[12px] text-omega-stone truncate">
              {serviceBadgeLabel(job.service)}{job.city ? ` · ${job.city}` : ''} · {photos.length} photos
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-omega-stone flex-shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((ph, i) => (
            <button
              key={i}
              onClick={() => onViewPhoto(ph)}
              className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group"
            >
              <img
                src={ph.url}
                alt={ph.title || `Photo ${i + 1}`}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.opacity = '0'; }}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhotoViewer({ photo, onClose }) {
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (photo.title || 'omega-photo').replace(/[^a-z0-9._-]+/gi, '_') + guessExt(photo.url);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in a new tab so Ramon can save it manually.
      window.open(photo.url, '_blank', 'noopener');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); download(); }}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-sm font-semibold backdrop-blur-sm disabled:opacity-60"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Download
        </button>
        <button onClick={onClose} className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <img
        src={photo.url}
        alt={photo.title || 'Photo'}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-[88vh] object-contain rounded-lg"
      />
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function isPdf(url) {
  return /\.pdf(\?|$)/i.test(url || '');
}
function guessExt(url) {
  const m = /\.(jpe?g|png|webp|heic|heif|gif)(\?|$)/i.exec(url || '');
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}
