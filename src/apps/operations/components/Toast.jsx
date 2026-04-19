import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ICONS = {
  success: <CheckCircle className="w-5 h-5 text-omega-success" />,
  error: <XCircle className="w-5 h-5 text-omega-danger" />,
  warning: <AlertTriangle className="w-5 h-5 text-omega-warning" />,
  info: <Info className="w-5 h-5 text-omega-info" />,
};
const BG = {
  success: 'bg-green-50 border-green-200',
  error: 'bg-red-50 border-red-200',
  warning: 'bg-amber-50 border-amber-200',
  info: 'bg-blue-50 border-blue-200',
};

export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm ${BG[type]}`}>
      {ICONS[type]}
      <p className="flex-1 text-sm font-medium text-omega-charcoal">{message}</p>
      <button onClick={onClose}><X className="w-4 h-4 text-omega-stone" /></button>
    </div>
  );
}
