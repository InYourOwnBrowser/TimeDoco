import React from 'react';

type PanelProps = React.HTMLAttributes<HTMLDivElement>;

export const Panel: React.FC<PanelProps> = ({ className = '', children, ...props }) => {
  return (
    <div className={`bg-stone dark:bg-graphite rounded-panel border border-graphite/20 dark:border-white/15 shadow-sm ${className}`} {...props}>
      {children}
    </div>
  );
};
