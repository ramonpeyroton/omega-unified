// MobileDailyLogs — the dedicated, full-screen "Daily Logs" section reached
// from the mobile bottom bar (Sales / Owner / Manager). It's a thin wrapper
// around DailyLogsRichTab in `standalone` mode: the list of project chats
// fills the screen, tapping one opens that chat full-screen (a fixed overlay
// the rich tab paints above the bottom bar), and the in-component back arrow
// returns to the list.
//
// Mobile-only by design. On desktop (md+) the bottom bars are hidden so this
// route isn't normally reached; if a desktop user types /daily-logs directly
// it renders the familiar two-column layout — harmless.
//
// Height: `h-[calc(100dvh-4rem)]` reserves the 64px the fixed bottom bar
// occupies so the chat list scrolls clear of it. The chat pane escapes this
// via its own `fixed inset-0` overlay (see DailyLogsRichTab).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import DailyLogsRichTab from './DailyLogsRichTab';
import PageHeader from './ui/PageHeader';

export default function MobileDailyLogs({ user }) {
  const navigate = useNavigate();
  // Tracked for potential aria/active-state use; the bottom bar is covered
  // by the chat overlay rather than toggled, so nothing else needs it yet.
  const [, setPane] = useState('list');

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] md:h-full min-h-0">
      {/* Same thin bar as every other secondary screen. The chat pane paints
          a fixed overlay above this (with its own back-to-list header), so
          this header belongs to the chat-list view. Non-sticky — the rich
          tab owns its own internal scroll. */}
      <PageHeader icon={MessageCircle} title="Daily Logs" onBack={() => navigate('/')} sticky={false} />
      <DailyLogsRichTab standalone user={user} onPaneChange={setPane} />
    </div>
  );
}
