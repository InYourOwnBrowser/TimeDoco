import React from 'react';

type PanelProps = React.HTMLAttributes<HTMLDivElement>;

export const Panel: React.FC<PanelProps> = ({ className = '', children, ...props }) => {
  return (
    <div className={`bg-stone dark:bg-graphite rounded-panel border border-graphite/10 dark:border-white/10 ${className}`} {...props}>
      {children}
    </div>
  );
};
