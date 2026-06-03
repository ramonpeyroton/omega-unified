import { createContext } from 'react';

// Lets the Home top-bar hamburger (☰) open the same "More" overflow sheet
// that the bottom-bar ••• item opens. Provided by SalesShell (App.jsx),
// consumed by Home. Kept in its own module so App and Home don't import
// each other (circular).
export const SalesMobileMenuContext = createContext({ openMore: () => {} });
