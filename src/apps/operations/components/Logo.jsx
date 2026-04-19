import logoImg from '../assets/logo.png';

export default function Logo({ size = 'md' }) {
  const heights = { sm: 'h-8', md: 'h-10', lg: 'h-14' };
  return (
    <img
      src={logoImg}
      alt="Omega"
      className={`${heights[size] || heights.md} w-auto`}
    />
  );
}
