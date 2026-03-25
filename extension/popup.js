// ─── 初始化 ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get('port');
  if (stored.port) document.getElementById('portInput').value = stored.port;

  document.getElementById('portInput').addEventListener('change', async (e) => {
    chrome.storage.local.set({ port: e.target.value.trim() });
    updateProfileLink();
    await loadProfiles();
  });
  document.getElementById('portInput').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      chrome.storage.local.set({ port: e.target.value.trim() });
      updateProfileLink();
      await loadProfiles();
    }
  });

  await loadProfiles();
  updateProfileLink();

  document.getElementById('fillBtn').addEventListener('click', fillForm);
});

function updateProfileLink() {
  document.getElementById('openProfileLink').href = `${getBase()}/profile-page`;
}

function getBase() {
  return `http://localhost:${document.getElementById('portInput').value.trim() || '8005'}`;
}

// ─── 加载档案列表 ─────────────────────────────────────────
async function loadProfiles() {
  const sel = document.getElementById('profileSelect');
  try {
    const res = await fetch(`${getBase()}/profiles`);
    const profiles = await res.json();
    if (profiles.length === 0) {
      sel.innerHTML = '<option value="">暂无档案，请先上传简历</option>';
      return;
    }
    sel.innerHTML = profiles.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');
    showStatus(`✅ 已连接，${profiles.length} 份档案`, 'success');
  } catch (e) {
    sel.innerHTML = '<option value="">⚠️ 连接失败</option>';
    showStatus(`无法连接 ${getBase()}，请检查端口`, 'error');
  }
}

// ─── 填表逻辑（直接注入到页面执行）──────────────────────
function pageFillerFn(profile) {
  const host = window.location.hostname;

  // ── 智联校园网申表（xiaoyuan.zhaopin.com）──────────────
  if (host.includes('xiaoyuan.zhaopin.com')) {
    return new Promise(resolve => {
      let filled = 0;

      function gv(path) {
        let v = profile;
        for (const k of path.split('.')) {
          if (v == null) return '';
          v = Array.isArray(v) ? v[parseInt(k)] : v[k];
        }
        return (v == null || v === '无') ? '' : String(v);
      }

      function setNative(el, value) {
        if (!value || !el || el.value.trim() || el.readOnly) return false;
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (s) s.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      function findInput(placeholder) {
        return Array.from(document.querySelectorAll('input.el-input__inner'))
          .find(el => el.placeholder === placeholder && !el.value.trim() && !el.readOnly);
      }

      function calcAge(bd) {
        if (!bd) return '';
        const b = new Date(bd.length === 7 ? bd + '-01' : bd);
        const n = new Date();
        let a = n.getFullYear() - b.getFullYear();
        if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
        return isNaN(a) ? '' : String(a);
      }

      function mapPolitical(v) {
        if (!v) return '';
        if (v.includes('共青团') || v === '团员') return '团员';
        if (v.includes('中共') || v.includes('党员')) return '中共党员（含预备党员）';
        if (v.includes('民主党派')) return '民主党派';
        if (v.includes('无党派')) return '无党派人士';
        return v;
      }

      function mapHealth(v) {
        if (!v) return '';
        if (v === '良好') return '良好';
        if (v === '一般') return '健康';
        if (v === '较差') return '有病史';
        return v;
      }

      // ① 文本字段（同步填入）
      [
        ['请填写您的真实姓名',         gv('basic.name')],
        ['请填写有效的电子邮箱地址',   gv('basic.email')],
        ['请填写通信地址',             gv('basic.location')],
        ['年龄',                       calcAge(gv('extended.birthdate'))],
      ].forEach(([ph, val]) => {
        if (setNative(findInput(ph), val)) filled++;
      });

      // ② 下拉字段（异步依次打开选中）
      const dropdowns = [
        { ph: '请选择民族',         val: gv('extended.ethnicity') },
        { ph: '请选择您的健康状况', val: mapHealth(gv('extended.health')) },
        { ph: '请选择您的婚姻状况', val: gv('extended.marriage') },
        { ph: '请选择您的政治面貌', val: mapPolitical(gv('extended.political')) },
      ].filter(d => d.val);

      // ② 下拉字段
      function setElSelect(ph, val) {
        if (!val) return false;
        const input = findInput(ph);
        if (!input) return false;
        const wrapper = input.closest('.el-select');
        if (!wrapper) return false;

        // 优先：直接调用 Vue 组件 API（不需要打开下拉）
        const vm = wrapper.__vue__;
        if (vm && vm.options) {
          const option = Array.from(vm.options).find(o => {
            const label = String(o.currentLabel || o.label || '');
            return label === val || label.includes(val) || val.includes(label);
          });
          if (option && vm.handleOptionSelect) {
            vm.handleOptionSelect(option, true);
            return true;
          }
        }

        // 备用：模拟 mousedown 打开（比 click 更可靠）
        wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        wrapper.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
        wrapper.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
        setTimeout(() => {
          const match = Array.from(document.querySelectorAll('.el-select-dropdown__item'))
            .find(o => { const t = o.textContent.trim(); return t === val || t.includes(val) || val.includes(t); });
          if (match) { match.click(); }
          document.body.click();
        }, 400);
        return true;
      }

      dropdowns.forEach(({ ph, val }) => {
        if (setElSelect(ph, val)) filled++;
      });

      // 高亮剩余未填字段
      let hl = 0;
      document.querySelectorAll('input.el-input__inner').forEach(el => {
        if (!el.value.trim() && !el.readOnly) {
          el.style.outline = '2px solid #fbbf24';
          el.style.backgroundColor = '#fffbeb';
          hl++;
        }
      });
      resolve({ filled, highlighted: hl });
    });
  }

  // ── 智联简历编辑页（i.zhaopin.com，iView 组件）──────────
  if (host.includes('zhaopin.com')) {
    let filled = 0, highlighted = 0;
    function gv2(path) {
      let v = profile;
      for (const k of path.split('.')) { if (!v) return ''; v = Array.isArray(v) ? v[parseInt(k)] : v[k]; }
      return (v == null || v === '无') ? '' : String(v);
    }
    function setIvu(el, value) {
      if (!value || !el || el.value.trim()) return false;
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (s) s.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    [
      ['input.ivu-input[placeholder*="真实姓名"]', 'basic.name'],
      ['input.ivu-input[placeholder*="生日"]',     'extended.birthdate'],
      ['input[placeholder*="邮箱"]',               'basic.email'],
    ].forEach(([sel, path]) => {
      const el = document.querySelector(sel);
      if (setIvu(el, gv2(path))) filled++;
    });
    document.querySelectorAll('input.ivu-input, .ivu-select').forEach(el => {
      const val = el.tagName === 'INPUT' ? el.value : el.querySelector('.ivu-select-selected-value')?.textContent;
      if (!val?.trim()) { el.style.outline = '2px solid #fbbf24'; el.style.backgroundColor = '#fffbeb'; highlighted++; }
    });
    return { filled, highlighted };
  }

  // ── 通用填表（下方原有逻辑）─────────────────────────────

  const KEYWORD_MAP = [
    { kw: ['姓名', 'name', 'full_name', 'realname', 'fullname', '真实姓名'], path: 'basic.name' },
    { kw: ['邮箱', 'email', 'mail', '电子邮件', 'e-mail'],                   path: 'basic.email' },
    { kw: ['手机', 'phone', 'mobile', 'tel', '电话', '联系方式', '联系电话'], path: 'basic.phone' },
    { kw: ['城市', 'city', 'location', '所在城市', '居住城市', '现居城市'],   path: 'basic.location' },
    { kw: ['linkedin'],                                                       path: 'basic.linkedin' },
    { kw: ['学校', 'school', 'university', 'college', '院校', '毕业院校'],    path: 'education.0.school' },
    { kw: ['学历', 'degree', 'education_level', '最高学历', '学位'],          path: 'education.0.degree' },
    { kw: ['专业', 'major', 'subject', '所学专业'],                           path: 'education.0.major' },
    { kw: ['gpa', '绩点'],                                                    path: 'education.0.gpa' },
    { kw: ['毕业时间', '毕业年份', 'graduation', '毕业'],                     path: 'education.0.end' },
    { kw: ['入学', '入读', 'enrollment'],                                     path: 'education.0.start' },
    { kw: ['公司', 'company', '工作单位', 'employer', '雇主'],                path: 'experience.0.company' },
    { kw: ['职位', 'position', 'title', 'job_title', '岗位', '职称'],        path: 'experience.0.title' },
    // 扩展信息
    { kw: ['性别', 'gender', 'sex'],                                          path: 'extended.gender' },
    { kw: ['出生', 'birth', 'birthday', '生日', '出生日期', '出生年月'],      path: 'extended.birthdate' },
    { kw: ['民族', 'ethnicity', 'nation'],                                    path: 'extended.ethnicity' },
    { kw: ['政治', 'political', '政治面貌', '党员'],                          path: 'extended.political' },
    { kw: ['籍贯', 'hometown', '户籍', '户口'],                               path: 'extended.hometown' },
    { kw: ['健康', 'health', '健康状况'],                                     path: 'extended.health' },
    { kw: ['婚姻', 'marriage', 'marital', '婚否'],                            path: 'extended.marriage' },
    { kw: ['身高', 'height'],                                                 path: 'extended.height' },
    { kw: ['体重', 'weight'],                                                 path: 'extended.weight' },
    { kw: ['期望城市', '求职城市', 'target_city', '意向城市'],               path: 'extended.target_city' },
    { kw: ['期望薪资', '薪资要求', 'salary', '薪酬期望'],                    path: 'extended.salary_min' },
    { kw: ['到岗', '入职时间', 'availability', '最快到岗'],                  path: 'extended.availability' },
    { kw: ['工作性质', 'job_type', '求职类型'],                               path: 'extended.job_type' },
  ];

  function getVal(p, path) {
    let v = p;
    for (const k of path.split('.')) {
      if (!v) return '';
      v = Array.isArray(v) ? v[parseInt(k)] : v[k];
    }
    if (v === null || v === undefined || v === '无') return '';
    return String(v);
  }

  function setVal(el, value) {
    if (!value) return;
    if (el.tagName === 'SELECT') {
      for (const opt of el.options) {
        if (opt.text.includes(value) || opt.value === value || value.includes(opt.text)) {
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      return;
    }
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const els = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"],' +
    'input[type="number"], input[type="url"], input:not([type]),' +
    'textarea, select'
  );

  let filled = 0, highlighted = 0;

  els.forEach(el => {
    if (['hidden','submit','button','checkbox','radio'].includes(el.type)) return;
    if (el.disabled || el.readOnly) return;
    if (el.value && el.value.trim()) return;

    const parts = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')];
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) parts.push(lbl.textContent);
    }
    const wrap = el.closest('label');
    if (wrap) parts.push(wrap.textContent);
    const prev = el.previousElementSibling;
    if (prev) parts.push(prev.textContent);
    const combined = parts.filter(Boolean).join(' ').toLowerCase();

    let matched = false;
    for (const m of KEYWORD_MAP) {
      if (m.kw.some(k => combined.includes(k.toLowerCase()))) {
        const val = getVal(profile, m.path);
        if (val) { setVal(el, val); filled++; }
        matched = true;
        break;
      }
    }
    if (!matched) {
      el.style.outline = '2px solid #fbbf24';
      el.style.backgroundColor = '#fffbeb';
      el.title = '⚠️ 请手动填写';
      highlighted++;
    }
  });

  return { filled, highlighted };
}

// ─── 一键填入 ─────────────────────────────────────────────
async function fillForm() {
  const profileId = document.getElementById('profileSelect').value;
  if (!profileId) { showStatus('请先选择档案', 'error'); return; }

  const btn = document.getElementById('fillBtn');
  btn.disabled = true;
  btn.textContent = '填入中...';
  showStatus('获取档案数据...', 'info');

  try {
    const res = await fetch(`${getBase()}/profiles/${profileId}`);
    if (!res.ok) throw new Error(`获取档案失败 (${res.status})`);
    const profile = await res.json();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('无法获取当前页面');

    showStatus('注入填表脚本...', 'info');

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageFillerFn,
      args: [profile]
    });

    const result = results?.[0]?.result;
    if (result) {
      const msg = `✅ 已填入 ${result.filled} 个字段` +
        (result.highlighted > 0 ? `\n⚠️ ${result.highlighted} 个字段已高亮，请手动填写` : '');
      showStatus(msg, 'success');
    } else {
      showStatus('完成，但未收到结果', 'info');
    }
  } catch (e) {
    showStatus(`❌ ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '一键填入';
  }
}

// ─── 状态显示 ─────────────────────────────────────────────
function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = `status ${type}`;
  el.style.display = 'block';
  el.style.whiteSpace = 'pre-line';
}
