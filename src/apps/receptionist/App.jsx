import { useEffect, useState } from 'react';
import NewLead from './screens/NewLead';
import LeadsList from './screens/LeadsList';
import Sidebar from './components/Sidebar';
import PendingVisitBanner from './components/PendingVisitBanner';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import PipelineKanban from '../../shared/components/PipelineKanban';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import JobFullView from '../../shared/components/JobFullView';
import DailyLogsScreen from '../../shared/components/DailyLogsScreen';
import { useBackNavHome } from '../../shared/lib/backNav';

const PENDING_VISIT_KEY = 'omega_receptionist_pending_visit';

// Receptionist app — three screens: Calendar (default), New Lead, My Leads.
// Same sidebar layout as the other roles so the UI feels consistent.
//
// After a lead is saved, the success screen offers a "Schedule Visit"
// button that jumps to Calendar with the EventForm pre-filled. The
// pending-visit job is persisted in sessionStorage so closing the form
// by mistake or navigating to another screen doesn't lose the context
// — a sticky orange banner brings the receptionist back to it.
// The pending visit is cleared only when she (a) actually saves the
// event, or (b) explicitly dismisses the banner.
export default function ReceptionistApp({ user, onLogout }) {
  const [screen, setScreen] = useState('calendar');
  const [fullViewJob, setFullViewJob] = useState(null);

  // Initial state — try to rehydrate a pending visit from sessionStorage
  // so a hard reload (or accidental click outside the form) doesn't drop
  // the context.
  const [scheduleJob, setScheduleJob] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(PENDING_VISIT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // Persist scheduleJob to sessionStorage whenever it changes.
  useEffect(() => {
    try {
      if (scheduleJob) sessionStorage.setItem(PENDING_VISIT_KEY, JSON.stringify(scheduleJob));
      else sessionStorage.removeItem(PENDING_VISIT_KEY);
    } catch { /* ignore quota errors */ }
  }, [scheduleJob]);

  function navigate(target) {
    // IMPORTANT: do NOT clear scheduleJob here. It used to be cleared
    // every time the user left the calendar, which dropped the
    // pending-visit context if she clicked anywhere else. The banner
    // is the new way to remember it across screens; it goes away only
    // when the visit is actually saved or explicitly dismissed.
    setScreen(target);
  }

  // Back button always returns to Calendar — keep scheduleJob intact.
  useBackNavHome(() => {
    if (screen !== 'calendar') setScreen('calendar');
  });

  function scheduleVisitFor(job) {
    setScheduleJob(job);
    setScreen('calendar');
  }

  // Wired into CalendarScreen — when the EventForm saves a visit that
  // was prefilled with our pending job, we know the lead is scheduled
  // and can drop the banner.
  function handleVisitScheduled(savedEvent) {
    // Clear regardless of which event was saved while the banner was
    // up — this matches the receptionist's mental model (she clicked
    // Save Event, the visit is scheduled, ditch the banner).
    setScheduleJob(null);
  }

  const renderScreen = () => {
    if (screen === 'calendar') {
      return (
        <CalendarScreen
          user={user}
          initialJobForVisit={scheduleJob}
          onVisitScheduled={handleVisitScheduled}
        />
      );
    }
    if (screen === 'new-lead') {
      return (
        <NewLead
          user={user}
          onLogout={onLogout}
          onViewLeads={() => navigate('leads')}
          onScheduleVisit={scheduleVisitFor}
        />
      );
    }
    if (screen === 'leads') {
      return (
        <LeadsList
          user={user}
          onBack={() => navigate('new-lead')}
          onLogout={onLogout}
        />
      );
    }
    if (screen === 'commissions') {
      return <CommissionsScreen user={user} />;
    }
    if (screen === 'daily-logs') {
      return <DailyLogsScreen user={user} onOpenJob={(job) => setFullViewJob(job)} />;
    }
    if (screen === 'pipeline') {
      // Read-only kanban — Rafaela can see where every lead is in the
      // funnel but cannot drag cards between phases nor open the full
      // job tools. Clicking a card surfaces a stripped JobFullView with
      // only the basic info tab (handled by the receptionist role gate
      // inside JobFullView itself).
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <PipelineKanban user={user} filterBySalesperson={false} readOnly />
        </div>
      );
    }
    return <CalendarScreen user={user} />;
  };

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <Sidebar
        screen={screen}
        onNavigate={navigate}
        onLogout={onLogout}
        userName={user?.name}
        user={user}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Sticky banner reminds the receptionist of any pending visit
            she still needs to schedule. Only renders when scheduleJob
            is set and we're not already standing inside the calendar. */}
        {scheduleJob && screen !== 'calendar' && (
          <PendingVisitBanner
            job={scheduleJob}
            onContinue={() => setScreen('calendar')}
            onDismiss={() => setScheduleJob(null)}
          />
        )}
        {renderScreen()}
      </main>
      {fullViewJob && (
        <JobFullView
          job={fullViewJob}
          user={user}
          onClose={() => setFullViewJob(null)}
          onJobUpdated={(u) => setFullViewJob(u)}
          onJobDeleted={() => setFullViewJob(null)}
        />
      )}
    </div>
  );
}
