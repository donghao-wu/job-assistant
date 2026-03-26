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
  // ── Ant Design 通用适配器（antd / React）─────────────────
  // 适用平台：c.liepin.com（猎聘）及一切使用 Ant Design 的表单
  // 通过 .ant-form-item-label 关键词匹配字段
  // ════════════════════════════════════════════════════════
  if (document.querySelector('.ant-form-item')) {
    return new Promise(async resolve => {
      let filled = 0;

      // ── React 原生 setter（触发受控组件更新）──────────
      function setReactInput(el, value) {
        if (!value || !el || el.readOnly) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      // ── 通过 label 关键词找 ant-form-item ─────────────
      function findItem(keywords) {
        return Array.from(document.querySelectorAll('.ant-form-item')).find(item => {
          const lbl = (item.querySelector('.ant-form-item-label label')?.textContent || '').toLowerCase();
          return keywords.some(k => lbl.includes(k.toLowerCase()));
        });
      }

      // ── 填写 ant-input 文本框 ─────────────────────────
      function fillInput(keywords, value) {
        if (!value) return false;
        const item = findItem(keywords);
        if (!item) return false;
        const el = item.querySelector('input.ant-input:not(.ant-select-selection-search-input), textarea.ant-input');
        if (!el || el.readOnly || el.value.trim()) return false;
        return setReactInput(el, value);
      }

      // ── 填写 ant-radio-button（性别等）──────────────
      function fillRadio(keywords, value) {
        if (!value) return false;
        const item = findItem(keywords);
        if (!item) return false;
        const wrapper = Array.from(item.querySelectorAll('.ant-radio-button-wrapper, .ant-radio-wrapper'))
          .find(el => el.textContent.trim() === value || el.textContent.trim().includes(value));
        if (!wrapper) return false;
        if (wrapper.classList.contains('ant-radio-button-wrapper-checked') ||
            wrapper.classList.contains('ant-radio-wrapper-checked')) return false;
        wrapper.click();
        return true;
      }

      // ── 填写 ant-select 下拉（click→等待→click选项）─
      function fillSelect(keywords, value) {
        return new Promise(res => {
          if (!value) return res(false);
          const item = findItem(keywords);
          if (!item) return res(false);
          // 如果已经有值，跳过
          const current = item.querySelector('.ant-select-selection-item')?.textContent?.trim();
          if (current && current !== '请选择') return res(false);
          const selector = item.querySelector('.ant-select-selector');
          if (!selector) return res(false);
          selector.click();
          setTimeout(() => {
            const match = Array.from(document.querySelectorAll('.ant-select-item-option:not(.ant-select-item-option-disabled)'))
              .find(o => { const t = o.textContent.trim(); return t === value || t.includes(value) || value.includes(t); });
            if (match) { match.click(); return res(true); }
            document.body.click();
            res(false);
          }, 400);
        });
      }

      // ── 政治面貌映射（猎聘选项为完整名称）──────────
      function mapPolitical(v) {
        if (!v) return '';
        if (v.includes('共青团') || v === '团员') return '共青团员';
        if (v.includes('中共') || v.includes('党员')) return '中共党员';
        if (v.includes('民主党派')) return '民主党派人士';
        if (v.includes('无党派')) return '无党派人士';
        if (v.includes('群众')) return '群众';
        return v;
      }

      // ── 字段映射表 ────────────────────────────────────
      const TEXT_FIELDS = [
        { kw: ['真实姓名', '姓名'],         path: 'basic.name' },
        { kw: ['邮箱', '邮件', 'email'],    path: 'basic.email' },
        { kw: ['linkedin'],                  path: 'basic.linkedin' },
      ];

      const RADIO_FIELDS = [
        { kw: ['性别'],  path: 'extended.gender' },
      ];

      const SELECT_FIELDS = [
        { kw: ['政治面貌', '政治'],    path: 'extended.political', mapFn: mapPolitical },
        { kw: ['最高学历', '学历'],    path: 'education.0.degree' },
        { kw: ['目前状态', '求职状态'], path: 'extended.job_type' },
        { kw: ['婚姻'],               path: 'extended.marriage' },
      ];

      // ── 执行填写 ─────────────────────────────────────
      TEXT_FIELDS.forEach(({ kw, path }) => {
        if (fillInput(kw, gv(path))) filled++;
      });

      RADIO_FIELDS.forEach(({ kw, path }) => {
        if (fillRadio(kw, gv(path))) filled++;
      });

      for (const { kw, path, mapFn } of SELECT_FIELDS) {
        const raw = gv(path);
        const val = mapFn ? mapFn(raw) : raw;
        if (await fillSelect(kw, val)) filled++;
      }

      // ── 高亮未填字段 ──────────────────────────────────
      let highlighted = 0;
      document.querySelectorAll('.ant-form-item').forEach(item => {
        const lbl = item.querySelector('.ant-form-item-label label')?.textContent?.trim();
        if (!lbl) return;
        const input = item.querySelector('input.ant-input:not(.ant-select-selection-search-input)');
        const hasEmptySelect = item.querySelector('.ant-select-selection-placeholder');
        if ((input && !input.value.trim() && !input.readOnly) || hasEmptySelect) {
          item.style.outline = '2px solid #fbbf24';
          item.style.borderRadius = '4px';
          highlighted++;
        }
      });

      resolve({ filled, highlighted });
    });
  }

  // ════════════════════════════════════════════════════════
  // ── 58同城简历创建页（jianli.58.com/resumebase）───────────
  // 自定义 jQuery 下拉，选项为 <a class="select-option">
  // ════════════════════════════════════════════════════════
  if (host.includes('58.com') && document.querySelector('li.birthday.cate-list, li.education.cate-list')) {
    let filled = 0, highlighted = 0;

    // 填写普通文本 input
    function set58Input(selector, value) {
      if (!value) return false;
      const el = document.querySelector(selector);
      if (!el || el.value.trim()) return false;
      el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // 点击 cate-list 里匹配文字的 select-option
    function set58Select(liClass, value) {
      if (!value) return false;
      const li = document.querySelector(`li.${liClass}.cate-list`);
      if (!li) return false;
      const opt = Array.from(li.querySelectorAll('a.select-option'))
        .find(a => {
          const t = a.textContent.trim();
          return t === value || t.includes(value) || value.includes(t);
        });
      if (!opt) return false;
      opt.click();
      return true;
    }

    // 性别（.sex-input div）
    function set58Gender(gender) {
      if (!gender) return false;
      const isFemale = gender === '女' || gender.toLowerCase() === 'female';
      const target = Array.from(document.querySelectorAll('.sex-input'))
        .find(el => isFemale ? el.textContent.trim() === '女' : el.textContent.trim() === '男');
      if (!target || target.classList.contains('selected')) return false;
      target.click();
      return true;
    }

    // 期望薪资：将 salary_min 映射到 58同城的薪资段
    function mapSalary(val) {
      if (!val) return '';
      const n = parseInt(String(val).replace(/[^\d]/g, ''));
      if (isNaN(n) || n === 0) return '面议';
      if (n < 1000)  return '1000元以下';
      if (n < 2000)  return '1000-2000元';
      if (n < 3000)  return '2000-3000元';
      if (n < 5000)  return '3000-5000元';
      if (n < 8000)  return '5000-8000元';
      if (n < 12000) return '8000-12000元';
      if (n < 20000) return '12000-20000元';
      if (n < 25000) return '20000-25000元';
      return '25000元以上';
    }

    // 学历映射
    function mapDegree(val) {
      if (!val) return '';
      if (val.includes('博士'))        return '博士';
      if (val.includes('硕士') || val.includes('研究生')) return '硕士';
      if (val.includes('MBA') || val.includes('EMBA')) return 'MBA/EMBA';
      if (val.includes('本科') || val.includes('学士')) return '本科';
      if (val.includes('大专') || val.includes('专科')) return '大专';
      if (val.includes('中专') || val.includes('技校')) return '中专/技校';
      if (val.includes('高中'))        return '高中';
      return val;
    }

    // 工作年限映射（应届生 / 实习生 → 应届生）
    function mapWorkTime(val) {
      if (!val) return '应届生';  // 默认应届生
      if (val.includes('应届') || val.includes('实习') || val.includes('在校')) return '应届生';
      if (val.includes('无') || val === '0') return '无经验';
      return val;
    }

    // 从出生日期中提取年份
    function birthYear(bd) {
      if (!bd) return '';
      const m = String(bd).match(/(\d{4})/);
      return m ? m[1] : '';
    }

    // ── 填写各字段 ────────────────────────────────────────
    if (set58Input('input[name="truename"]', gv('basic.name'))) filled++;
    if (set58Gender(gv('extended.gender'))) filled++;
    if (set58Select('birthday',  birthYear(gv('extended.birthdate')))) filled++;
    if (set58Select('education', mapDegree(gv('education.0.degree')))) filled++;
    if (set58Select('workTime',  mapWorkTime(gv('extended.job_type')))) filled++;
    if (set58Select('salary',    mapSalary(gv('extended.salary_min')))) filled++;

    // ── 高亮未填字段 ──────────────────────────────────────
    // 文本 inputs
    document.querySelectorAll('input[name="truename"]').forEach(el => {
      if (!el.value.trim()) { el.style.outline = '2px solid #fbbf24'; highlighted++; }
    });
    // 未选中的下拉（com-select-left 为空）
    document.querySelectorAll('li.salary.cate-list .com-select-left.values,' +
      'li.birthday.cate-list .com-select-left.values,' +
      'li.workTime.cate-list .com-select-left.values,' +
      'li.education.cate-list .com-select-left.values').forEach(el => {
      if (!el.textContent.trim()) {
        el.closest('.com-select')?.style && (el.closest('.com-select').style.outline = '2px solid #fbbf24');
        highlighted++;
      }
    });

    return { filled, highlighted };
  }

  // ════════════════════════════════════════════════════════
  // ── xiaoyuan.zhaopin.com 网申多分区适配器（El UI / Vue2）─
  // 顺序填写：个人信息 → 教育经历 → 实习/工作经历 → 语言能力 → 专业技能
  // 每个分区需先点击导航、点击"立即添加"、填写、再点击"添 加"保存
  // ════════════════════════════════════════════════════════
  if (host.includes('xiaoyuan.zhaopin.com') && document.querySelector('li.resume-menu-item')) {
    return new Promise(async resolve => {
      let filled = 0;
      const sleep = ms => new Promise(r => setTimeout(r, ms));

      // ── 原生 setter + Vue2 响应式（兼容 textarea 及无 __vue__ 的 el-input）──
      function setNative(el, value) {
        if (!el || !value || value === '无') return false;
        const isTA = el.tagName === 'TEXTAREA';
        // 先通过原生 setter 更新 DOM 值
        const proto = isTA ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        nativeSetter ? nativeSetter.call(el, value) : (el.value = value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // 再尝试通过 .el-input 包裹层的 Vue 实例 $emit 更新响应式状态
        // （针对 input.__vue__ 为空、但父级 div.el-input 有 __vue__ 的情况）
        const elInputDiv = isTA ? null : el.closest('.el-input');
        const elInputVm  = elInputDiv?.__vue__;
        if (elInputVm?.$emit) {
          elInputVm.$emit('input',  value);
          elInputVm.$emit('change', value);
        }
        return true;
      }

      // ── el-select 按 label 文字选中（精确优先，再回退模糊）
      function elSel(selEl, labelText) {
        if (!labelText || !selEl?.__vue__?.options) return false;
        const opts = selEl.__vue__.options;
        // 精确匹配优先，避免"学士"误中"双学士"等
        const opt = opts.find(o => String(o.currentLabel || o.label || '') === labelText)
                 || opts.find(o => { const l = String(o.currentLabel || o.label || ''); return l.includes(labelText) || labelText.includes(l); });
        if (opt && selEl.__vue__.handleOptionSelect) {
          selEl.__vue__.handleOptionSelect(opt, true);
          return true;
        }
        return false;
      }

      // ── 将各种常见日期字符串统一解析为 Date 对象 ──────────
      function parseDate(dateStr) {
        if (!dateStr || dateStr === '无') return null;
        let s = dateStr.trim();
        // 英文月份：January 2022 / Jan 2022
        const EN_MONTHS = ['january','february','march','april','may','june',
                           'july','august','september','october','november','december'];
        const mEn = s.match(/^([a-zA-Z]+)\s+(\d{4})$/);
        if (mEn) {
          const mi = EN_MONTHS.indexOf(mEn[1].toLowerCase());
          if (mi >= 0) s = `${mEn[2]}-${String(mi+1).padStart(2,'0')}-01`;
        }
        // 中文格式：2020年9月 / 2020年09月
        s = s.replace(/(\d{4})\s*年\s*(\d{1,2})\s*月?/, (_, y, m) => `${y}-${m.padStart(2,'0')}-01`);
        // 点分格式：2020.09
        s = s.replace(/^(\d{4})\.(\d{1,2})$/, (_, y, m) => `${y}-${m.padStart(2,'0')}-01`);
        // 斜线格式：2020/09
        s = s.replace(/^(\d{4})\/(\d{1,2})$/, (_, y, m) => `${y}-${m.padStart(2,'0')}-01`);
        // 补齐月份：2020-9 → 2020-09
        s = s.replace(/^(\d{4})-(\d)$/, (_, y, m) => `${y}-0${m}-01`);
        // 仅年份：2020 → 2020-01-01
        if (/^\d{4}$/.test(s)) s += '-01-01';
        // 年月格式：2020-09 → 2020-09-01
        if (/^\d{4}-\d{2}$/.test(s)) s += '-01';
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
      }

      // ── 从 input 向上遍历 DOM 找到 ElDatePicker Vue 实例 ──
      function findDatePickerVm(input) {
        let node = input.parentElement;
        let elInputVm = null;
        while (node && node !== document.body) {
          const vm = node.__vue__;
          if (vm) {
            const name = vm.$options?.name;
            if (name === 'ElDatePicker') return vm;
            if (name === 'ElInput') elInputVm = vm; // 记住 ElInput，继续往上找
          }
          node = node.parentElement;
        }
        // 找到 ElInput 但没找到 ElDatePicker → 用其 $parent
        return elInputVm?.$parent || null;
      }

      // ── el-date-picker 通过 Vue emit 设置值（绕过 readonly input）
      function setDateEl(input, dateStr) {
        if (!input || !dateStr || dateStr === '无') return false;
        const d = parseDate(dateStr);
        if (!d) { console.warn('[填表] 日期解析失败:', dateStr); return false; }
        const dpVm = findDatePickerVm(input);
        console.log('[填表] setDateEl →', dateStr, '| dpVmName:', dpVm?.$options?.name);
        if (!dpVm) { console.warn('[填表] 找不到 dpVm'); return false; }
        dpVm.$emit('input', d);
        dpVm.$emit('change', d);
        console.log('[填表] date emitted, input.value now:', input.value);
        return true;
      }

      // ── 按 placeholder 关键词找最后一个 input（多条目时取最新行）
      function lastPh(ph) {
        const all = Array.from(document.querySelectorAll('.el-input__inner'))
          .filter(i => i.placeholder.includes(ph));
        return all[all.length - 1];
      }

      // ── 导航至分区，处理弹出的保存提示 ──────────────────
      async function navTo(idx) {
        document.querySelectorAll('li.resume-menu-item')[idx]?.click();
        await sleep(500);
        const saveBtn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.trim() === '保存并跳转');
        const skipBtn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.trim() === '不保存');
        if (saveBtn)      { saveBtn.click(); await sleep(700); }
        else if (skipBtn) { skipBtn.click(); await sleep(300); }
      }

      // ── 打开分区表单（有则编辑第一条，无则新增）────────
      async function openForEdit() {
        // 已在编辑态（有可填写的 input）
        const editable = Array.from(document.querySelectorAll('.el-input__inner'))
          .some(i => !i.readOnly || i.closest('.el-date-editor'));
        if (editable) return;
        // 有已有条目 → 点击"编辑"进入编辑态
        const editSpan = Array.from(document.querySelectorAll('.icon-box .icon-text'))
          .find(s => s.textContent.trim() === '编辑');
        if (editSpan) { editSpan.closest('.icon-box')?.click(); await sleep(400); return; }
        // 空分区 → 点击"立即添加"
        document.querySelector('.add-now')?.click();
        await sleep(400);
      }

      // ── 新增一条条目（保存后点"+"添加下一条）────────────
      async function addNew() {
        const addNow = document.querySelector('.add-now');
        const addIcon = Array.from(document.querySelectorAll('.icon-box .icon-text'))
          .find(s => s.textContent.trim() === '添加');
        (addNow || addIcon?.closest('.icon-box'))?.click();
        await sleep(400);
      }

      // ── 点击当前表单的主保存按钮（添 加 / 保存 / 确定）─
      async function saveCur() {
        const btn = Array.from(document.querySelectorAll('button.el-button--primary'))
          .find(b => {
            const t = b.textContent.replace(/\s/g, '');
            return (t.includes('添加') || t.includes('保存') || t.includes('确定'))
                && !t.includes('立即投递') && !b.disabled;
          });
        if (!btn) return;
        btn.click();
        // 轮询等待 API 响应完成（最多 8s，按钮 is-loading 消失即完成）
        for (let i = 0; i < 16; i++) {
          await sleep(500);
          if (!document.querySelector('button.el-button--primary.is-loading')) break;
        }
        await sleep(300);
      }

      // ── 学历 / 学位 映射 ─────────────────────────────────
      const toXueli = d => {
        if (!d) return '';
        if (d.includes('博士')) return '博士研究生';
        if (d.includes('MBA') || d.includes('EMBA')) return 'MBA';
        if (d.includes('硕士') || d.includes('研究生')) return '硕士研究生';
        if (d.includes('大专') || d.includes('专科')) return '大专';
        return '本科';
      };
      const toXuewei = d => {
        if (!d) return '';
        if (d.includes('博士')) return '博士';
        if (d.includes('MBA')) return 'MBA';
        if (d.includes('硕士') || d.includes('研究生')) return '硕士';
        if (d.includes('大专') || d.includes('专科')) return '其他';
        return '学士';
      };

      // ══ 0. 个人信息 ══════════════════════════════════════
      // 该分区由智联招聘账号数据自动填充，所有字段均以 labelOnly-text 显示
      // 无可编辑的 el-input__inner，跳过即可

      // ══ 1. 教育经历 ══════════════════════════════════════
      await navTo(1);
      const edu = profile.education?.[0];
      if (edu) {
        console.log('[填表] edu=', JSON.stringify(edu));
        await openForEdit();
        await sleep(800); // 等 Vue 组件挂载完毕再填
        // 只填空字段，不覆盖已有值
        const s0 = lastPh('学校全称');
        if (s0 && !s0.value.trim() && edu.school && edu.school !== '无') if (setNative(s0, edu.school)) filled++;
        const s1 = lastPh('入学时间');
        console.log('[填表] s1 found:', !!s1, 'val:', s1?.value, 'edu.start:', edu.start);
        if (s1 && !s1.value.trim() && edu.start && edu.start !== '无') {
          const ok = setDateEl(s1, edu.start);
          console.log('[填表] s1 setDateEl ok:', ok, '→ s1.value:', s1?.value);
          if (ok) filled++;
        }
        const s2 = lastPh('毕业时间');
        if (s2 && !s2.value.trim() && edu.end && edu.end !== '无') if (setDateEl(s2, edu.end)) filled++;
        const s3 = lastPh('院系');
        if (s3 && !s3.value.trim()) {
          const deptVal = edu.major && edu.major !== '无' ? edu.major : edu.school;
          if (deptVal) { setNative(s3, deptVal); filled++; }
        }
        // 专业名称（placeholder='请填写专业名称'）
        const s4 = lastPh('专业名称');
        if (s4 && !s4.value.trim() && edu.major && edu.major !== '无') { setNative(s4, edu.major); filled++; }
        // el-select 字段：仅填空值
        document.querySelectorAll('.el-select').forEach(s => {
          const inp = s.querySelector('.el-input__inner');
          const ph  = inp?.placeholder || '';
          if (inp?.value?.trim()) return; // 已有值跳过
          if (ph.includes('教育类型'))                        elSel(s, '全日制统分统招');
          else if (ph.includes('学位') && !ph.includes('学历')) elSel(s, toXuewei(edu.degree));
          else if (ph.includes('学历'))                       elSel(s, toXueli(edu.degree));
          else if (ph.includes('年级排名'))                   elSel(s, '前20%');
          else if (ph.includes('海外'))                       elSel(s, '无');
          else if (ph.includes('专升本'))                     elSel(s, '否');
        });
        await saveCur();
      }

      // ══ 3. 实习/工作经历 ════════════════════════════════
      await navTo(3);
      let firstExp = true;
      for (const exp of (profile.experience || [])) {
        if (!exp.company || exp.company === '无') continue;
        if (firstExp) { await openForEdit(); firstExp = false; }
        else { await addNew(); }
        const e0 = lastPh('单位的名称');
        if (e0 && !e0.value.trim()) if (setNative(e0, exp.company)) filled++;
        const e1 = lastPh('入职时间');
        if (e1 && !e1.value.trim() && exp.start && exp.start !== '无') if (setDateEl(e1, exp.start)) filled++;
        const e2 = lastPh('离职时间');
        if (e2 && !e2.value.trim() && exp.end && exp.end !== '无') if (setDateEl(e2, exp.end)) filled++;
        const e3 = lastPh('职务');
        if (e3 && !e3.value.trim() && exp.title && exp.title !== '无') if (setNative(e3, exp.title)) filled++;
        // 工作类型 select（2=全职, 1=兼职, 4=实习）
        const typeVal = exp.type?.includes('全职') ? 2 : exp.type?.includes('兼职') ? 1 : 4;
        const typeSel = Array.from(document.querySelectorAll('.el-select'))
          .find(s => s.querySelector('.el-input__inner')?.placeholder.includes('工作类型'));
        if (typeSel?.__vue__?.options) {
          const opt = typeSel.__vue__.options.find(o => o.value === typeVal);
          if (opt) typeSel.__vue__.handleOptionSelect(opt, true);
        }
        // 工作描述 textarea
        const ta = Array.from(document.querySelectorAll('textarea'))
          .find(t => t.placeholder.includes('工作内容'));
        if (ta && !ta.value.trim() && exp.bullets?.length) {
          setNative(ta, exp.bullets.join('\n'));
          filled++;
        }
        await saveCur();
      }

      // ══ 4. 语言能力 ══════════════════════════════════════
      await navTo(4);
      const langs = gv('skills.languages');
      if (langs) {
        await openForEdit();
        const certEl = lastPh('英语证书');
        if (certEl && !certEl.value.trim()) { setNative(certEl, langs); filled++; }
        const ls = Array.from(document.querySelectorAll('.el-select'));
        // ls[0]=语种(英语=1), ls[1]=听说能力(熟练=3), ls[2]=读写能力(熟练=3)
        [1, 3, 3].forEach((val, i) => {
          if (!ls[i]?.__vue__?.options) return;
          const o = ls[i].__vue__.options.find(op => op.value === val);
          if (o) ls[i].__vue__.handleOptionSelect(o, true);
        });
        await saveCur();
      }

      // ══ 5. 专业技能 ══════════════════════════════════════
      await navTo(5);
      const techList = gv('skills.technical').split(/[,，]/).map(s => s.trim()).filter(Boolean);
      let firstSkill = true;
      for (const skill of techList.slice(0, 5)) {
        if (firstSkill) { await openForEdit(); firstSkill = false; }
        else { await addNew(); }
        // 技能类型：无 placeholder、非 el-select 内的输入框（取最后一个 = 最新添加行）
        const skillIn = Array.from(document.querySelectorAll('.el-input__inner'))
          .filter(i => !i.closest('.el-select') && !i.readOnly && !i.placeholder).pop();
        if (skillIn && !skillIn.value.trim()) { setNative(skillIn, skill); filled++; }
        // 技能掌握程度 → 熟练(3)
        const lvSel = Array.from(document.querySelectorAll('.el-select'))
          .find(s => s.querySelector('.el-input__inner')?.placeholder.includes('掌握'));
        if (lvSel?.__vue__?.options) {
          const o = lvSel.__vue__.options.find(op => op.value === 3);
          if (o) lvSel.__vue__.handleOptionSelect(o, true);
        }
        await saveCur();
      }

      // ══ 6. 奖励荣誉 ══════════════════════════════════════
      await navTo(6);
      const awards = (profile.awards || []).filter(a => a.name && a.name !== '无');
      let firstAward = true;
      for (const award of awards) {
        if (firstAward) { await openForEdit(); firstAward = false; }
        else { await addNew(); }
        await sleep(800);
        const a0 = lastPh('在校期间所获的奖励');
        if (a0 && !a0.value.trim()) { setNative(a0, award.name); filled++; }
        const a1 = lastPh('奖励荣誉获得时间');
        if (a1 && !a1.value.trim() && award.date && award.date !== '无') if (setDateEl(a1, award.date)) filled++;
        // 颁奖机构：优先用 award.institution，其次学校名兜底
        const a2 = lastPh('颁奖机构');
        if (a2 && !a2.value.trim()) {
          const inst = (award.institution && award.institution !== '无')
            ? award.institution
            : profile.education?.[0]?.school;
          if (inst && inst !== '无') { setNative(a2, inst); filled++; }
        }
        await saveCur();
      }

      // ══ 8. 其他信息 ══════════════════════════════════════
      await navTo(8);
      await openForEdit();
      await sleep(800);
      const ta8 = Array.from(document.querySelectorAll('textarea'))
        .find(t => t.placeholder.includes('专长'));
      if (ta8 && !ta8.value.trim()) {
        // 优先用用户填写的自我评价，否则自动拼装
        const selfIntro = profile.extended?.self_intro;
        let summary = '';
        if (selfIntro && selfIntro !== '无') {
          summary = selfIntro;
        } else {
          const techSkills = gv('skills.technical');
          const projs = (profile.projects || []).filter(p => p.name && p.name !== '无');
          const parts = [];
          if (techSkills) parts.push('技能：' + techSkills);
          if (projs.length) parts.push('项目经历：' + projs.map(p => p.name).join('；'));
          summary = parts.join('\n');
        }
        if (summary) { setNative(ta8, summary); filled++; await saveCur(); }
      }

      resolve({ filled, highlighted: 0 });
    });
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
      args: [profile],
      world: 'MAIN'   // 必须在主世界才能访问页面的 __vue__ 实例
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
