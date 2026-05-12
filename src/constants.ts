import { FileItem } from './types';

export const ACCENT_COLORS = [
  '#7cb342', // Grass Green
  '#a8c7fa', // Blue
  '#d0bcff', // Purple
  '#fde293', // Yellow
  '#ffb4ab', // Red
  '#6dd58c', // Green
];

export const MOCK_FILES: FileItem[] = [
  // Root Level - Downloads
  { id: 'f1', name: 'Design Assets', type: 'folder', modified: '今天 10:00', path: '/Downloads/Design Assets', size: '--' },
  { id: 'f2', name: 'Reports 2023', type: 'folder', modified: '昨天', path: '/Downloads/Reports 2023', size: '--' },
  { id: 'f_deep', name: 'Nested Projects', type: 'folder', modified: '1 week ago', path: '/Downloads/Nested Projects', size: '--' },
  { id: '1', name: 'hero_bg_final_v2.png', type: 'image', size: '12.4 MB', modified: '今天 14:32', path: '/Downloads', thumbnail: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBQaXlgdcEiNN0sYMD3rocVU-5d2b-_XD5uZFXSwEYeJo7ULqBTpdOM1oUFgdLrboDpyZP0inaNt0DE7TMab76fYUtdWxkrX5TtxIguf3LiVwBaJTUhQusUw9XGELw7BIGtRozie1EdADi6Y8W01hwWmaiyq0u3qEu3VT2te9BXL0H_ZS4hbilMT-yJsS-LjiQxulIA7xZ7UdjkcEsifGRwCKKqzBGL-cqXD1YKetuGdRAIkMHXh77ybi8fvjw5Q7FgQnW6UqOC7cBb', tags: ['设计', 'Hero'], dimensions: '1920x1080' },
  
  // Design Assets inside /Downloads/Design Assets
  { id: '10', parentId: 'f1', name: 'Mockups.zip', type: 'archive', size: '250 MB', modified: 'Oct 15', path: '/Downloads/Design Assets' },
  { id: '11', parentId: 'f1', name: 'Logo_Final.pdf', type: 'pdf', size: '1.2 MB', modified: 'Oct 12', path: '/Downloads/Design Assets' },

  // Reports inside /Downloads/Reports 2023
  { id: '20', parentId: 'f2', name: 'Q1_Financial.docx', type: 'file', size: '845 KB', modified: 'Mar 1', path: '/Downloads/Reports 2023' },
  { id: '21', parentId: 'f2', name: 'Q2_Financial.docx', type: 'file', size: '920 KB', modified: 'Jun 1', path: '/Downloads/Reports 2023' },

  // Deeply nested structure
  { id: 'd1', parentId: 'f_deep', name: 'Project Alpha', type: 'folder', modified: 'May 1', path: '/Downloads/Nested Projects/Project Alpha', size: '--' },
  { id: 'd2', parentId: 'f_deep', name: 'Project Beta', type: 'folder', modified: 'May 2', path: '/Downloads/Nested Projects/Project Beta', size: '--' },
  
  // Inside Project Alpha
  { id: 'd1_1', parentId: 'd1', name: 'Source Code', type: 'folder', modified: 'May 1', path: '/Downloads/Nested Projects/Project Alpha/Source Code', size: '--' },
  { id: 'd1_2', parentId: 'd1', name: 'Assets', type: 'folder', modified: 'May 1', path: '/Downloads/Nested Projects/Project Alpha/Assets', size: '--' },
  { id: 'd1_file1', parentId: 'd1', name: 'Readme.md', type: 'file', size: '12 KB', modified: 'May 1', path: '/Downloads/Nested Projects/Project Alpha' },

  // Level 1-5 Nesting
  { id: 'nest_1', parentId: 'f_deep', name: 'Nesting L1', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Nesting L1' },
  { id: 'nest_2', parentId: 'nest_1', name: 'Nesting L2', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Nesting L1/Nesting L2' },
  { id: 'nest_3', parentId: 'nest_2', name: 'Nesting L3', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Nesting L1/L2/Nesting L3' },
  { id: 'nest_4', parentId: 'nest_3', name: 'Nesting L4', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Nesting L1/L2/L3/Nesting L4' },
  { id: 'nest_5', parentId: 'nest_4', name: 'Nesting L5', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Nesting L1/L2/L3/L4/Nesting L5' },
  { id: 'nest_file', parentId: 'nest_5', name: 'Secret_Level5.pdf', type: 'pdf', size: '4.2 MB', modified: 'Just now', path: '/Downloads/.../Nesting L5' },

  // More Files for Downloads
  { id: 'm1', name: 'Product_Catalog_2024.pdf', type: 'pdf', size: '15.2 MB', modified: '10:15 AM', path: '/Downloads' },
  { id: 'm2', name: 'Brand_Guidelines.zip', type: 'archive', size: '84.2 MB', modified: '11:00 AM', path: '/Downloads' },
  { id: 'm3', name: 'App_Icon_Set', type: 'folder', size: '--', modified: 'Yesterday', path: '/Downloads/App_Icon_Set' },
  { id: 'm3_1', parentId: 'm3', name: 'icon_ios.png', type: 'image', size: '1.2 MB', modified: 'Yesterday', path: '/Downloads/App_Icon_Set' },
  { id: 'm4', name: 'Recording_Feedback.mp4', type: 'video', size: '210 MB', modified: 'Yesterday', path: '/Downloads' },
  { id: 'm5', name: 'Budget_Q4.xlsx', type: 'file', size: '1.1 MB', modified: 'Monday', path: '/Downloads' },
  { id: 'm6', name: 'Team_Photo.jpg', type: 'image', size: '4.5 MB', modified: 'Oct 20', path: '/Downloads' },
  { id: 'm7', name: 'Draft_Specs.docx', type: 'file', size: '890 KB', modified: 'Oct 18', path: '/Downloads' },
  { id: 'm8', name: 'Release_Notes.txt', type: 'file', size: '45 KB', modified: 'Oct 15', path: '/Downloads' },
  { id: 'm9', name: 'Presentation_Final.pptx', type: 'file', size: '22 MB', modified: 'Oct 12', path: '/Downloads' },
  { id: 'm10', name: 'Backup_db_01.sql', type: 'file', size: '512 MB', modified: 'Oct 10', path: '/Downloads' },
  { id: 'm11', name: 'User_Interviews', type: 'folder', size: '--', modified: 'Oct 8', path: '/Downloads/User_Interviews' },
  { id: 'm11_1', parentId: 'm11', name: 'Interview_1.mp3', type: 'video', size: '12 MB', modified: 'Oct 8', path: '/Downloads/User_Interviews' },
  { id: 'm12', name: 'Package_v1.0.tar.gz', type: 'archive', size: '120 MB', modified: 'Oct 5', path: '/Downloads' },
  { id: 'm13', name: 'Readme_First.html', type: 'file', size: '5 KB', modified: 'Oct 1', path: '/Downloads' },
  { id: 'm14', name: 'Assets_Icon.svg', type: 'image', size: '12 KB', modified: 'Sep 28', path: '/Downloads' },
  { id: 'm15', name: 'Contract_Signed.pdf', type: 'pdf', size: '3.1 MB', modified: 'Sep 25', path: '/Downloads' },
  { id: 'm16', name: 'Script_Automation.py', type: 'file', size: '8 KB', modified: 'Sep 20', path: '/Downloads' },
  { id: 'm17', name: 'Old_Drafts', type: 'folder', size: '--', modified: 'Aug 12', path: '/Downloads/Old_Drafts' },
  { id: 'm18', name: 'Invoices', type: 'folder', size: '--', modified: 'Aug 10', path: '/Downloads/Invoices' },
  { id: 'm19', name: 'Tutorial_vids', type: 'folder', size: '--', modified: 'Jul 30', path: '/Downloads/Tutorial_vids' },
  { id: 'm20', name: 'Logs_2023.txt', type: 'file', size: '1.2 MB', modified: 'Jan 12', path: '/Downloads' },
  { id: 'm21', name: 'Extremely_Long_Filename_That_Should_Probably_Wrap_Or_Break_Properly_In_The_Grid_View_Test_Case_001_Final_Final_V2_Revision_31.pdf', type: 'pdf', size: '2.4 MB', modified: 'Just now', path: '/Downloads' },
  { id: 'm22', name: 'Another_Very_Deep_Folder_With_A_Long_Name_To_Check_Breadcrumbs_Behavior_In_The_Interface_That_Goes_On_And_On_And_On', type: 'folder', size: '--', modified: 'Just now', path: '/Downloads/Deep_Folder' },
  { id: 'm23', name: 'Ultra_High_Res_Render_For_Product_Showcase_Marketing_Materials_2024_Q4_Export.png', type: 'image', size: '45.8 MB', modified: 'Oct 5', path: '/Downloads' },

  // Inside alpha Source Code
  { id: 'sc_1', parentId: 'd1_1', name: 'Components', type: 'folder', modified: 'May 2', path: '/Downloads/Nested Projects/Project Alpha/Source Code/Components', size: '--' },
  { id: 'sc_2', parentId: 'd1_1', name: 'Hooks', type: 'folder', modified: 'May 2', path: '/Downloads/Nested Projects/Project Alpha/Source Code/Hooks', size: '--' },
  { id: 'sc_file1', parentId: 'd1_1', name: 'index.ts', type: 'file', size: '2 KB', modified: 'May 2', path: '/Downloads/Nested Projects/Project Alpha/Source Code' },

  // Inside alpha components
  { id: 'comp_1', parentId: 'sc_1', name: 'Button.tsx', type: 'file', size: '4 KB', modified: 'May 3', path: '/Downloads/Nested Projects/Project Alpha/Source Code/Components' },
  { id: 'comp_2', parentId: 'sc_1', name: 'Card.tsx', type: 'file', size: '5 KB', modified: 'May 3', path: '/Downloads/Nested Projects/Project Alpha/Source Code/Components' },
  { id: 'comp_3', parentId: 'sc_1', name: 'Modal', type: 'folder', modified: 'May 4', path: '/Downloads/Nested Projects/Project Alpha/Source Code/Components/Modal', size: '--' },

  // Inside Modal
  { id: 'modal_1', parentId: 'comp_3', name: 'index.tsx', type: 'file', size: '8 KB', modified: 'May 5', path: '/Downloads/Nested Projects/Project Alpha/Source Code/Components/Modal' },
  { id: 'modal_2', parentId: 'comp_3', name: 'styles.css', type: 'file', size: '1 KB', modified: 'May 5', path: '/Downloads/Nested Projects/Project Alpha/Source Code/Components/Modal' },

  // Let's add more deep nesting
  { id: 'deep_1', parentId: 'f_deep', name: 'Deep Level 1', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Deep Level 1', size: '--' },
  { id: 'deep_2', parentId: 'deep_1', name: 'Deep Level 2', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Deep Level 1/Deep Level 2', size: '--' },
  { id: 'deep_3', parentId: 'deep_2', name: 'Deep Level 3', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Deep Level 1/Deep Level 2/Deep Level 3', size: '--' },
  { id: 'deep_4', parentId: 'deep_3', name: 'Deep Level 4', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Deep Level 1/Deep Level 2/Deep Level 3/Deep Level 4', size: '--' },
  { id: 'deep_5', parentId: 'deep_4', name: 'Deep Level 5', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Deep Level 1/Deep Level 2/Deep Level 3/Deep Level 4/Deep Level 5', size: '--' },
  { id: 'deep_6', parentId: 'deep_5', name: 'Deep Level 6', type: 'folder', modified: 'Today', path: '/Downloads/Nested Projects/Deep Level 1/Deep Level 2/Deep Level 3/Deep Level 4/Deep Level 5/Deep Level 6', size: '--' },
  { id: 'deep_file', parentId: 'deep_6', name: 'Hidden_Treasure.txt', type: 'file', size: '1 Byte', modified: 'Today', path: '/Downloads/Nested Projects/Deep Level 1/.../Deep Level 6' },

  { id: '2', name: 'Q3_Report_Draft.pdf', type: 'pdf', size: '2.1 MB', modified: '昨天', path: '/Downloads', tags: ['Work'] },
  { id: '3', name: 'System_Architecture.docx', type: 'file', size: '845 KB', modified: 'Mon', path: '/Downloads', tags: ['Specs'] },
  { id: '4', name: 'Demo_Recording.mp4', type: 'video', size: '156 MB', modified: 'Oct 12', path: '/Downloads' },
  { id: '5', name: 'Assets_Bundle.zip', type: 'archive', size: '42 MB', modified: 'Oct 10', path: '/Downloads' }
];

export const QUICK_ACCESS = [
  { id: 'q1', name: 'Projects', items: 12, modified: '今天', icon: 'folder', color: 'primary' },
  { id: 'q2', name: 'Designs', items: 45, modified: '昨天', icon: 'palette', color: 'secondary' },
  { id: 'q3', name: 'Photos', items: 892, modified: '上周', icon: 'image', color: 'tertiary' },
];
