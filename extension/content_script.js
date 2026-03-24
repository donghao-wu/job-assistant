// ─── 监听来自 popup 的消息 ────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FILL_FORM') {
    const result = fillForm(msg.profile);
    sendResponse(result);
  }
  return true;
});

// ─── 字段关键词映射表 ─────────────────────────────────────
// path 格式：顶级字段.索引.子字段
const KEYWORD_MAP = [
  // 基本信息
  { kw: ['姓名', 'name', 'full_name', 'realname', '真实姓名', 'fullname'],      path: 'basic.name' },
  { kw: ['邮箱', 'email', 'mail', '电子邮件', 'e-mail'],                        path: 'basic.email' },
  { kw: ['手机', 'phone', 'mobile', 'tel', '电话', '联系方式', '联系电话'],     path: 'basic.phone' },
  { kw: ['城市', 'city', 'location', '所在城市', '居住城市', '现居城市'],       path: 'basic.location' },
  { kw: ['linkedin'],                                                            path: 'basic.linkedin' },
  // 教育经历
  { kw: ['学校', 'school', 'university', 'college', '院校', '毕业院校', '就读'],path: 'education.0.school' },
  { kw: ['学历', 'degree', 'education_level', '最高学历', '学位'],              path: 'education.0.degree' },
  { kw: ['专业', 'major', 'subject', '所学专业', 'discipline'],                 path: 'education.0.major' },
  { kw: ['gpa', '绩点', '成绩'],                                                 path: 'education.0.gpa' },
  { kw: ['毕业时间', '毕业年份', 'graduation', 'graduate_date', '毕业'],        path: 'education.0.end' },
  { kw: ['入学', '入读', 'enrollment', 'start_school'],                         path: 'education.0.start' },
  // 工作经历
  { kw: ['公司', 'company', '工作单位', '单位名称', 'employer', '雇主'],        path: 'experience.0.company' },
  { kw: ['职位', 'position', 'title', 'job_title', '岗位', '职称'],            path: 'experience.0.title' },
  { kw: ['工作开始', '入职时间', 'work_start', 'job_start'],                    path: 'experience.0.start' },
  { kw: ['工作结束', '离职时间', 'work_end', 'job_end'],                        path: 'experience.0.end' },
];

// ─── 从 profile 对象取值 ──────────────────────────────────
function getVal(profile, path) {
  const parts = path.split('.');
  let v = profile;
  for (const p of parts) {
    if (v === null || v === undefined) return '';
    // 数字索引处理数组
    v = Array.isArray(v) ? v[parseInt(p)] : v[p];
  }
  if (v === null || v === undefined || v === '无') return '';
  return String(v);
}

// ─── 匹配单个表单元素 ─────────────────────────────────────
function matchField(el, profile) {
  // 收集所有描述文本
  const candidates = [
    el.name,
    el.id,
    el.placeholder,
    el.getAttribute('aria-label'),
    el.getAttribute('data-field'),
    el.getAttribute('data-name'),
    el.getAttribute('label'),
  ];

  // label[for="id"]
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) candidates.push(label.textContent);
  }

  // 父级 label 或相邻文本
  const parentLabel = el.closest('label');
  if (parentLabel) candidates.push(parentLabel.textContent);

  // 前一个兄弟/父节点文本（常见于自定义组件）
  const prev = el.previousElementSibling;
  if (prev) candidates.push(prev.textContent);
  const parentText = el.parentElement?.previousElementSibling?.textContent;
  if (parentText) candidates.push(parentText);

  const combined = candidates
    .filter(Boolean)
    .map(s => s.toLowerCase().trim())
    .join(' ');

  for (const mapping of KEYWORD_MAP) {
    for (const kw of mapping.kw) {
      if (combined.includes(kw.toLowerCase())) {
        return getVal(profile, mapping.path);
      }
    }
  }
  return null; // 未识别
}

// ─── 设置字段值（兼容 React/Vue）────────────────────────
function setNativeValue(el, value) {
  if (!value) return;

  // select 元素：找匹配的 option
  if (el.tagName === 'SELECT') {
    for (const opt of el.options) {
      if (opt.text.includes(value) || opt.value === value ||
          value.includes(opt.text) || value.includes(opt.value)) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    return;
  }

  // input / textarea：用原生 setter 兼容 React
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ─── 高亮未识别字段 ───────────────────────────────────────
function highlightUnknown(el) {
  el.style.outline = '2px solid #fbbf24';
  el.style.backgroundColor = '#fffbeb';
  el.setAttribute('title', '⚠️ 求职小助手无法识别此字段，请手动填写');
}

// ─── 平台专项适配（预留，后续扩充）──────────────────────
const PLATFORM_ADAPTERS = {
  // 'zhipin.com': fillZhipin,
  // 'zhaopin.com': fillZhaopin,
  // '51job.com':   fill51job,
};

// ─── 主流程 ───────────────────────────────────────────────
function fillForm(profile) {
  // 检查平台专项适配
  const hostname = window.location.hostname;
  for (const [domain, adapter] of Object.entries(PLATFORM_ADAPTERS)) {
    if (hostname.includes(domain)) return adapter(profile);
  }

  // 通用逻辑
  const els = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"],' +
    'input[type="number"], input[type="url"], input:not([type]),' +
    'textarea, select'
  );

  let filled = 0;
  let highlighted = 0;

  els.forEach(el => {
    // 跳过隐藏/禁用/只读/已填 字段
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
    if (el.disabled || el.readOnly) return;
    if (el.value && el.value.trim()) return;

    const value = matchField(el, profile);

    if (value !== null && value !== '') {
      setNativeValue(el, value);
      filled++;
    } else {
      highlightUnknown(el);
      highlighted++;
    }
  });

  return { filled, highlighted };
}
