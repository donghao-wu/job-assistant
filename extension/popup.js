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

// ─── 填表逻辑（注入到页面执行）────────────────────────────
function pageFillerFn(profile) {
  const host = window.location.hostname;

  // ════════════════════════════════════════════════════════
  // ── 通用工具函数 ─────────────────────────────────────────
  // ════════════════════════════════════════════════════════

  function gv(path) {
    let v = profile;
    for (const k of path.split('.')) {
      if (v == null) return '';
      v = Array.isArray(v) ? v[parseInt(k)] : v[k];
    }
    return (v == null || v === '无') ? '' : String(v);
  }

  function calcAge(bd) {
    if (!bd) return '';
    const b = new Date(bd.length === 7 ? bd + '-01' : bd);
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() ||
       (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return isNaN(a) ? '' : String(a);
  }

  // ════════════════════════════════════════════════════════
  // ── Element UI 通用适配器（el-input__inner）──────────────
  // 适用平台：xiaoyuan.zhaopin.com / shixiseng.com /
  //           campus.51job.com / 等一切使用 Element UI 的校招表单
  // ════════════════════════════════════════════════════════
  if (document.querySelector('.el-input__inner')) {
    return new Promise(resolve => {
      let filled = 0;

      // ── 文本/数字字段关键词映射 ────────────────────────
      // kw: 匹配 placeholder 的关键词列表（小写）
      // path: profile 数据路径，或 fn: 自定义取值函数
      const TEXT_MAP = [
        { kw: ['姓名', 'name', '真实姓名', '您的姓名', '请输入姓名'], path: 'basic.name' },
        { kw: ['邮箱', 'email', '电子邮件', '邮件地址', '邮件'],       path: 'basic.email' },
        { kw: ['手机', 'phone', 'mobile', '联系电话', '联系方式', '电话号码'], path: 'basic.phone' },
        { kw: ['通信地址', '居住地址', '现居地址', '联系地址', '地址'],  path: 'basic.location' },
        { kw: ['linkedin'],                                             path: 'basic.linkedin' },
        { kw: ['年龄', 'age'],   fn: () => calcAge(gv('extended.birthdate')) },
        { kw: ['出生日期', '出生年月', '生日', 'birth'],               path: 'extended.birthdate' },
        { kw: ['籍贯', '户籍', '户口所在地', '家庭所在地'],            path: 'extended.hometown' },
        { kw: ['身高', 'height'],                                       path: 'extended.height' },
        { kw: ['体重', 'weight'],                                       path: 'extended.weight' },
        { kw: ['期望薪资', '薪资期望', '薪酬期望', '期望工资', '薪资要求'], path: 'extended.salary_min' },
        { kw: ['最快到岗', '到岗时间', '入职时间', '可到岗'],          path: 'extended.availability' },
        { kw: ['期望城市', '求职城市', '意向城市', '目标城市'],        path: 'extended.target_city' },
        { kw: ['学校', 'university', 'college', '院校', '毕业院校'],   path: 'education.0.school' },
        { kw: ['专业', 'major', '所学专业'],                           path: 'education.0.major' },
        { kw: ['gpa', '绩点', '成绩'],                                  path: 'education.0.gpa' },
      ];

      // ── 下拉字段关键词映射 ─────────────────────────────
      // mapFn: 将 profile 值转换为平台实际选项文字
      const SELECT_MAP = [
        {
          kw: ['性别', 'gender', '您的性别'],
          path: 'extended.gender',
          mapFn: v => v  // 男/女 通常一致
        },
        {
          kw: ['民族', 'ethnicity', '族'],
          path: 'extended.ethnicity',
          mapFn: v => v  // 56 个民族名称通常一致
        },
        {
          kw: ['政治面貌', '政治', 'political', '党员'],
          path: 'extended.political',
          mapFn: v => {
            if (!v) return '';
            if (v.includes('共青团') || v === '团员')       return '团员';
            if (v.includes('中共') || v.includes('党员'))   return '中共党员（含预备党员）';
            if (v.includes('民主党派'))                      return '民主党派';
            if (v.includes('无党派'))                        return '无党派人士';
            if (v.includes('群众'))                          return '群众';
            return v;
          }
        },
        {
          kw: ['健康状况', '健康'],
          path: 'extended.health',
          mapFn: v => {
            if (!v) return '';
            const m = { '良好': '良好', '健康': '健康', '一般': '健康', '较差': '有病史' };
            return m[v] || v;
          }
        },
        {
          kw: ['婚姻状况', '婚姻', 'marital'],
          path: 'extended.marriage',
          mapFn: v => v  // 未婚/已婚/离异 通常一致
        },
        {
          kw: ['学历', 'degree', '最高学历', '学位'],
          path: 'education.0.degree',
          mapFn: v => v
        },
        {
          kw: ['工作性质', '求职类型', '期望类型', '实习全职'],
          path: 'extended.job_type',
          mapFn: v => v
        },
        {
          kw: ['毕业时间', '毕业年月', '预计毕业'],
          path: 'education.0.end',
          mapFn: v => v
        },
      ];

      // ── setNative：触发 Vue/React 响应式更新 ──────────
      function setNative(el, value) {
        if (!value || !el || el.value.trim() || el.readOnly) return false;
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (s) s.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      // ── setElSelect：调用 Vue 组件 API 直接选中选项 ───
      function setElSelect(inputEl, val) {
        if (!val) return false;
        const wrapper = inputEl.closest('.el-select');
        if (!wrapper) return false;

        // 优先：直接调用 Vue2 __vue__ 实例的内部方法
        const vm = wrapper.__vue__;
        if (vm && vm.options) {
          const opt = Array.from(vm.options).find(o => {
            const label = String(o.currentLabel || o.label || '');
            return label === val || label.includes(val) || val.includes(label);
          });
          if (opt && vm.handleOptionSelect) {
            vm.handleOptionSelect(opt, true);
            return true;
          }
        }

        // 备用：模拟点击打开下拉，再点击选项
        wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        wrapper.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
        setTimeout(() => {
          const match = Array.from(document.querySelectorAll('.el-select-dropdown__item'))
            .find(o => { const t = o.textContent.trim(); return t === val || t.includes(val) || val.includes(t); });
          if (match) match.click();
          document.body.click();
        }, 400);
        return true;
      }

      // ── 获取所有 el-input__inner 输入框 ──────────────
      const allInputs   = Array.from(document.querySelectorAll('input.el-input__inner'));
      const selectInputs = allInputs.filter(el => el.closest('.el-select'));
      const textInputs   = allInputs.filter(el => !el.closest('.el-select'));

      // ── 填写文本字段 ──────────────────────────────────
      textInputs.forEach(el => {
        if (el.value.trim() || el.readOnly) return;
        const ph = (el.placeholder || '').toLowerCase();
        for (const { kw, path, fn } of TEXT_MAP) {
          if (kw.some(k => ph.includes(k.toLowerCase()))) {
            const val = fn ? fn() : gv(path);
            if (setNative(el, val)) filled++;
            break;
          }
        }
      });

      // ── 填写下拉字段 ──────────────────────────────────
      selectInputs.forEach(el => {
        if (el.value.trim()) return;
        const ph = (el.placeholder || '').toLowerCase();
        for (const { kw, path, mapFn } of SELECT_MAP) {
          if (kw.some(k => ph.includes(k.toLowerCase()))) {
            const raw = gv(path);
            const val = mapFn ? mapFn(raw) : raw;
            if (val && setElSelect(el, val)) filled++;
            break;
          }
        }
      });

      // ── 高亮剩余未填字段 ──────────────────────────────
      let highlighted = 0;
      allInputs.forEach(el => {
        if (!el.value.trim() && !el.readOnly) {
          el.style.outline = '2px solid #fbbf24';
          el.style.backgroundColor = '#fffbeb';
          highlighted++;
        }
      });

      resolve({ filled, highlighted });
    });
  }

  // ════════════════════════════════════════════════════════
  // ── iView 适配器（i.zhaopin.com 简历编辑页等）──────────
  // ════════════════════════════════════════════════════════
  if (host.includes('zhaopin.com') && document.querySelector('.ivu-input')) {
    let filled = 0, highlighted = 0;

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
      if (setIvu(el, gv(path))) filled++;
    });

    document.querySelectorAll('input.ivu-input, .ivu-select').forEach(el => {
      const val = el.tagName === 'INPUT'
        ? el.value
        : el.querySelector('.ivu-select-selected-value')?.textContent;
      if (!val?.trim()) {
        el.style.outline = '2px solid #fbbf24';
        el.style.backgroundColor = '#fffbeb';
        highlighted++;
      }
    });

    return { filled, highlighted };
  }

  // ════════════════════════════════════════════════════════
  // ── 通用填表适配器（标准 HTML input / textarea / select）
  // 适用：所有未被上方规则匹配的页面
  // ════════════════════════════════════════════════════════

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
