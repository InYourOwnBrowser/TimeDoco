import React from 'react';
import { Sparkles } from 'lucide-react';
import { Panel } from './ui/Panel';

export const ResourcesView: React.FC = () => (
  <Panel className="w-full max-w-3xl mx-auto mt-8 text-center py-16">
    <Sparkles className="mx-auto mb-4 text-signal" size={32} />
    <h2 className="text-xl font-semibold text-graphite dark:text-stone mb-2">Resources</h2>
    <p className="text-gray-500 dark:text-gray-400">Curated tools and recommendations for freelancers and contractors — coming soon.</p>
  </Panel>
);
