const fs = require('fs');
const path = 'C:\\Users\\PC\\Desktop\\Pagina-web_React\\src\\routes\\RouterApp.jsx';
let content = fs.readFileSync(path, 'utf8');
content = content.replace('import(\\"../pages/sinFilas/views/AdminDashboard\\")', 'import(\\"../pages/sinFilas/views/SFAdminDashboard\\")');
content = content.replace('m.AdminDashboard', 'm.SFAdminDashboard');
fs.writeFileSync(path, content);
console.log('RouterApp.jsx updated');
