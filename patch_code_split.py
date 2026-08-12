import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Add Suspense and lazy to React import
content = content.replace("import { useState, useEffect } from 'react';", "import { useState, useEffect, Suspense, lazy } from 'react';")

# Replace direct imports of AnalysisView and GroupingManagement with lazy imports
content = content.replace("import { AnalysisView } from './components/AnalysisView';", "const AnalysisView = lazy(() => import('./components/AnalysisView').then(module => ({ default: module.AnalysisView })));")
content = content.replace("import { GroupingManagement } from './components/GroupingManagement';", "const GroupingManagement = lazy(() => import('./components/GroupingManagement').then(module => ({ default: module.GroupingManagement })));")

# Wrap components in Suspense when rendering
suspense_analysis = "<Suspense fallback={<div className=\"p-8 text-center text-gray-500\">Loading analysis...</div>}><AnalysisView /></Suspense>"
suspense_management = "<Suspense fallback={<div className=\"p-8 text-center text-gray-500\">Loading management...</div>}><GroupingManagement /></Suspense>"

content = content.replace("{activeTab === 'analysis' && <AnalysisView />}", "{activeTab === 'analysis' && " + suspense_analysis + "}")
content = content.replace("{activeTab === 'management' && <GroupingManagement />}", "{activeTab === 'management' && " + suspense_management + "}")


with open('src/App.tsx', 'w') as f:
    f.write(content)
