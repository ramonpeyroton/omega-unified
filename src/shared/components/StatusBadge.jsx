const STATUS_STYLES = {
  draft:     'bg-gray-100 text-gray-700 border-gray-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  sent:      'bg-blue-50 text-blue-700 border-blue-200',
  approved:  'bg-green-50 text-green-700 border-green-200',
  signed:    'bg-green-50 text-green-700 border-green-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  rejected:  'bg-red-50 text-red-700 border-red-200',
  declined:  'bg-red-50 text-red-700 border-red-200',
  expired:   'bg-red-100 text-red-800 border-red-300',
};

export default function StatusBadge({ status }) {
  const key = (status || 'draft').toString().toLowerCase();
  const cls = STATUS_STYLES[key] || STATUS_STYLES.draft;
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}
