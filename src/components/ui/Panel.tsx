import React from 'react';

type PanelProps = React.HTMLAttributes<HTMLDivElement>;

export const Panel: React.FC<PanelProps> = ({ className = '', children, ...props }) => {
  return (
    <div className={`bg-white dark:bg-graphite rounded-panel border border-graphite/20 dark:border-white/20 shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`} {...props}>
      {children}
    </div>
  );
};
