/**
 * @module i18n/locales/zh
 * @description 中文（简体）翻译资源包。
 *
 * 键值按模块分组组织：
 *  - common: 通用/共享文本（按钮、操作、状态等）
 *  - app: App 入口组件
 *  - vault: 仓库面板
 *  - fileTree: 文件树
 *  - editor: 编辑器
 *  - outline: 大纲面板
 *  - graph: 知识图谱
 *  - settings: 设置页面
 *  - commands: 命令系统
 *  - titlebar: 标题栏
 *  - quickSwitcher: 快速切换
 *  - commandPalette: 指令搜索
 *  - moveFileModal: 移动文件弹窗
 *  - image: 图片相关
 *  - frontmatter: frontmatter 编辑
 */

const zh = {
    /* ==================== 通用 ==================== */
    common: {
        save: "保存",
        cancel: "取消",
        delete: "删除",
        confirm: "确认",
        loading: "加载中...",
        error: "错误",
        success: "成功",
        close: "关闭",
        search: "搜索",
        noMatch: "无匹配项",
        rootDirectory: "(根目录)",
        newFile: "新建文件",
        newFolder: "新建文件夹",
        moveTo: "移动到",
        rename: "重命名",
        record: "录制",
        resetDefault: "恢复默认",
    },

    /* ==================== App 入口 ==================== */
    app: {
        homeTitle: "ofive 工作区",
        homeDescription: "主区域由 dockview 官方 React 适配驱动，支持可插拔的 tab 组件。",
        homeTabTitle: "首页",
        explorer: "资源管理器",
        calendar: "日历",
        knowledgeGraph: "知识图谱",
        graphPanelHint: "点击活动栏图谱图标打开知识图谱 Tab。",
        searchPanel: "搜索",
        searchPanelTitle: "搜索面板",
        searchPanelHint: "在这里接入全文检索能力。",
        outline: "大纲",
    },

    /* ==================== 仓库面板 ==================== */
    vault: {
        selectDirectory: "选择仓库目录",
        openDirectoryFailed: "打开系统目录选择器失败",
        readFileFailed: "读取文件失败",
        renameDirFailed: "重命名目录失败",
        renameFileFailed: "重命名文件失败",
        confirmDeleteDir: "确认删除目录 {{name}} 及其内容?",
        deleteDirFailed: "删除目录失败",
        confirmDeleteFile: "确认删除 {{name}}?",
        deleteFileFailed: "删除文件失败",
        dragMoveDirFailed: "拖拽移动目录失败",
        dragMoveFileFailed: "拖拽移动文件失败",
        createFileFailed: "创建文件失败",
        createFolderFailed: "创建文件夹失败",
        confirmDeleteSelection: "确认删除这 {{count}} 个项目?",
        currentDirectory: "当前目录：",
        openVault: "打开仓库",
        noVault: "当前尚未打开任何仓库，请先选择目录。",
        loadTreeFailed: "加载仓库目录树失败",
    },

    /* ==================== 文件树 ==================== */
    fileTree: {
        files: "文件",
        newFilePlaceholder: "新建文件",
        newFolderPlaceholder: "新建文件夹",
        dragSelectionLabel: "移动 {{count}} 个项目",
        emptyHint: "右键空白区域可新建文件或文件夹",
    },

    /* ==================== 编辑器 ==================== */
    editor: {
        defaultContent: "这是基于 CodeMirror 6 的编辑器示例内容。\n\n- 支持基础编辑\n- 支持 Markdown 语法高亮\n- 支持后续扩展语言和 LSP",
        newPageContent: "通过 [[{{target}}]] 打开的新页面。",
        untitledFile: "未命名.md",
        fileNameEmpty: "文件名不能为空",
        renameFailed: "重命名文件失败",
        fallbackContent: "浏览器回退模式下的示例内容。",
        noLocalBinaryRead: "浏览器回退模式不支持读取本地二进制文件",
        invalidSourcePath: "源文件路径无效",
        sourceNotExist: "源文件不存在",
        targetExists: "目标文件已存在",
        directoryPathEmpty: "目录路径不能为空",
    },

    /* ==================== 大纲面板 ==================== */
    outline: {
        noFocusedArticle: "未聚焦文章",
        focusArticleHint: "请先在主编辑区聚焦一篇文章。",
        noHeadings: "当前文章没有标题结构。",
        lineNumber: "第 {{line}} 行",
    },

    /* ==================== 知识图谱 ==================== */
    graph: {
        loadingGraph: "正在从后端加载 Markdown 图谱...",
        loadFailed: "加载失败：{{message}}",
        graphReady: "图谱已加载，可拖拽节点探索关系",
        noMarkdownNodes: "当前 vault 未发现 Markdown 节点",
        /* 图谱设置标题 */
        backgroundColor: "背景颜色",
        backgroundColorDesc: "图谱画布背景色。",
        pointDefaultColor: "节点颜色",
        pointDefaultColorDesc: "节点默认颜色。",
        pointDefaultSize: "节点大小",
        pointDefaultSizeDesc: "节点默认半径。",
        pointSizeScale: "节点缩放系数",
        pointSizeScaleDesc: "节点大小整体倍率。",
        pointOpacity: "节点透明度",
        pointOpacityDesc: "节点整体透明度。",
        linkDefaultColor: "边颜色",
        linkDefaultColorDesc: "边默认颜色。",
        linkDefaultWidth: "边宽度",
        linkDefaultWidthDesc: "边默认宽度。",
        linkWidthScale: "边缩放系数",
        linkWidthScaleDesc: "边宽度整体倍率。",
        linkOpacity: "边透明度",
        linkOpacityDesc: "边整体透明度。",
        simulationDecay: "衰减系数",
        simulationDecayDesc: "仿真衰减速度。",
        simulationGravity: "重力",
        simulationGravityDesc: "仿真重力系数。",
        simulationCenter: "中心力",
        simulationCenterDesc: "中心聚拢系数。",
        simulationRepulsion: "斥力",
        simulationRepulsionDesc: "节点间斥力系数。",
        simulationRepulsionTheta: "斥力 Theta",
        simulationRepulsionThetaDesc: "斥力近似参数。",
        simulationLinkSpring: "弹簧系数",
        simulationLinkSpringDesc: "边弹簧强度。",
        simulationLinkDistance: "边目标距离",
        simulationLinkDistanceDesc: "边的最小期望距离。",
        simulationRepulsionFromMouse: "鼠标斥力",
        simulationRepulsionFromMouseDesc: "鼠标施加斥力强度。",
        simulationFriction: "摩擦系数",
        simulationFrictionDesc: "运动阻尼系数。",
        simulationCluster: "聚类系数",
        simulationClusterDesc: "聚类力强度。",
        enableRightClickRepulsion: "右键斥力",
        enableRightClickRepulsionDesc: "是否启用右键鼠标斥力。",
        enableZoom: "允许缩放",
        enableZoomDesc: "是否允许缩放交互。",
        enableDrag: "允许拖拽",
        enableDragDesc: "是否允许拖拽节点。",
        enableSimulationDuringZoom: "缩放时仿真",
        enableSimulationDuringZoomDesc: "缩放期间保持仿真运行。",
        fitViewOnInit: "初始化 fitView",
        fitViewOnInitDesc: "初始化时是否自动适配视图。",
        fitViewDelay: "fitView 延迟",
        fitViewDelayDesc: "初始化 fitView 延迟（毫秒）。",
        fitViewPadding: "fitView 边距",
        fitViewPaddingDesc: "初始化 fitView 边距比例。",
        fitViewDuration: "fitView 动画",
        fitViewDurationDesc: "初始化 fitView 动画时长（毫秒）。",
        pixelRatio: "像素比",
        pixelRatioDesc: "画布渲染像素比。",
        scalePointsOnZoom: "缩放时节点放大",
        scalePointsOnZoomDesc: "缩放时节点是否同步缩放。",
        scaleLinksOnZoom: "缩放时边放大",
        scaleLinksOnZoomDesc: "缩放时边是否同步缩放。",
        pointSamplingDistance: "点采样距离",
        pointSamplingDistanceDesc: "可见点采样距离（像素）。",
        showFPSMonitor: "FPS 监视器",
        showFPSMonitorDesc: "是否显示性能监视器。",
        spaceSize: "仿真空间大小",
        spaceSizeDesc: "仿真空间边长。",
        rescalePositions: "重缩放坐标",
        rescalePositionsDesc: "是否自动重缩放点位坐标。",
        labelVisibleZoomLevel: "标签显示缩放阈值",
        labelVisibleZoomLevelDesc: "缩放级别达到此阈值后节点标签渐显。",
        /* 图谱设置面板 */
        settingsTitle: "知识图谱设置",
        settingsCountDesc: "共 {{count}} 项可配置参数",
        loadSettingsFailed: "加载图谱设置失败",
        saveSettingsFailed: "保存图谱设置失败",
        resetSettingsFailed: "重置图谱设置失败",
    },

    /* ==================== 日历 ==================== */
    calendar: {
        title: "日历",
        description: "按 frontmatter.date 聚合当前仓库中的笔记，并支持创建每日笔记。",
        sourceHint: "数据来自当前仓库中带有 frontmatter.date 字段的 Markdown 笔记。",
        loading: "正在加载带有日期 frontmatter 的笔记...",
        loadFailed: "加载失败：{{message}}",
        noVault: "当前尚未打开仓库。",
        noDateNotes: "当前仓库中没有包含 frontmatter.date 的笔记。",
        previousMonth: "上个月",
        nextMonth: "下个月",
        today: "今天",
        openCommand: "打开日历",
        createDailyNote: "创建每日笔记",
        openDailyNote: "打开每日笔记",
        notesForDay: "{{day}} 的笔记",
        notesForDayCount: "共 {{count}} 篇",
        notesForDayEmpty: "这一天还没有匹配 frontmatter.date 的笔记。",
        clickDayHint: "点击某一天可查看当日笔记列表。",
        dailyNoteCreated: "已创建每日笔记 {{path}}",
    },

    /* ==================== 设置 ==================== */
    settings: {
        title: "设置",
        noSections: "暂无可用设置项",
        noSectionsHint: "尚未注册设置选栏，请检查注册流程。",
        /* 通用设置 */
        generalSection: "通用",
        rememberLastVault: "保存上次打开仓库",
        rememberLastVaultDesc: "关闭后，下次启动不会自动恢复上次仓库路径",
        enableSearch: "开启搜索功能",
        enableSearchDesc: "关闭后，活动栏将隐藏搜索图标",
        enableKnowledgeGraph: "开启知识图谱功能",
        enableKnowledgeGraphDesc: "关闭后，知识图谱入口、命令和设置分区将被隐藏",
        /* 主题设置 */
        themeSection: "风格",
        themeTitle: "界面风格",
        themeDesc: "所有组件颜色通过中心化主题变量控制",
        themeDark: "夜间",
        themeDarkDesc: "适合弱光环境，降低屏幕眩光。",
        themeLight: "日间",
        themeLightDesc: "适合明亮环境，提升文本对比度。",
        themeKraft: "牛皮纸",
        themeKraftDesc: "泛黄纸面与棕褐墨色，适合测试全局主题扩展能力。",
        /* 编辑器设置 */
        editorSection: "编辑器",
        saveSection: "保存",
        vimMode: "Vim 编辑模式",
        vimModeDesc: "使用 Vim 键位（普通/插入模式）",
        lineWrapping: "自动换行",
        lineWrappingDesc: "超出编辑器宽度时自动折行",
        lineNumbers: "行号",
        lineNumbersDesc: "编辑器左侧行号栏显示模式",
        lineNumbersOff: "关闭",
        lineNumbersAbsolute: "绝对行号",
        lineNumbersRelative: "相对行号",
        fontSize: "字体大小",
        fontSizeDesc: "编辑器文本字号（10–32 px）",
        fontFamily: "编辑器字体",
        fontFamilyDesc: "选择编辑器内容区域使用的字体",
        fontFamilyReset: "重置默认",
        fontPresetSanFrancisco: "San Francisco（系统默认）",
        fontPresetInter: "Inter",
        fontPresetGeorgia: "Georgia（衬线）",
        fontPresetMonospace: "等宽字体",
        tabSize: "Tab 缩进宽度",
        tabSizeDesc: "Tab 键对应的空格数量（1–8）",
        autoSave: "自动保存",
        autoSaveDesc: "编辑后自动保存 Markdown 文件，无需手动按 Cmd+S",
        autoSaveDelay: "自动保存延迟",
        autoSaveDelayDesc: "停止输入后多久自动保存（500–10000 ms）",
        /* 快捷键设置 */
        shortcutSection: "快捷键",
        shortcutCommand: "命令",
        shortcutKeybinding: "快捷键",
        shortcutCondition: "条件",
        shortcutActions: "操作",
        shortcutRecordPlaceholder: "按下组合键…",
        shortcutInvalid: "快捷键格式无效，请重新录制或输入",
        loadShortcutFailed: "加载快捷键配置失败",
        saveShortcutFailed: "保存快捷键配置失败",
        /* 知识图谱设置 */
        graphSection: "知识图谱",
        /* 语言设置 */
        languageSection: "语言",
        languageTitle: "界面语言",
        languageDesc: "切换应用界面显示语言",
    },

    /* ==================== 命令系统 ==================== */
    commands: {
        newFilePrompt: "新建文件",
        closeCurrentTab: "关闭当前标签页",
        exitApp: "退出应用",
        toggleLeftSidebar: "显示/隐藏左侧边栏",
        toggleRightSidebar: "显示/隐藏右侧边栏",
        saveCurrentFile: "保存当前文件",
        createFileInDir: "在当前目录创建文件",
        createFolderInDir: "在当前目录创建文件夹",
        newFolderPrompt: "新建文件夹",
        renameCurrent: "重命名当前文件",
        renamePrompt: "重命名文件",
        undo: "撤销",
        redo: "重做",
        selectAll: "全选",
        find: "查找",
        toggleComment: "切换注释",
        increaseIndent: "增加缩进",
        decreaseIndent: "减少缩进",
        toggleBold: "切换加粗",
        toggleItalic: "切换斜体",
        toggleStrikethrough: "切换删除线",
        toggleInlineCode: "切换行内代码",
        toggleHighlight: "切换高亮",
        insertLink: "插入链接",
        copySelectedFile: "复制选中文件",
        pasteFileToDir: "粘贴文件到当前目录",
        deleteSelectedFile: "删除选中文件",
        moveFileToDir: "移动当前文件到目录",
        quickSwitcher: "快速切换",
        commandPalette: "打开指令搜索",
    },

    /* ==================== 焦点上下文 ==================== */
    focusContext: {
        editorFocused: "编辑器聚焦",
        fileTreeFocused: "文件树聚焦",
    },

    /* ==================== 标题栏 ==================== */
    titlebar: {
        closeApp: "关闭应用",
        toggleFullscreen: "切换全屏",
        minimizeWindow: "最小化窗口",
        maximizeWindow: "最大化窗口",
        showRightSidebar: "显示右侧边栏",
        hideRightSidebar: "隐藏右侧边栏",
    },

    /* ==================== 快速切换 ==================== */
    quickSwitcher: {
        ariaLabel: "快速切换",
        placeholder: "快速切换...",
        searching: "搜索中...",
        searchFailed: "搜索失败：{{message}}",
        noMatch: "无匹配笔记",
    },

    /* ==================== 指令搜索 ==================== */
    commandPalette: {
        ariaLabel: "指令搜索",
        placeholder: "输入指令名称...",
        noMatch: "无匹配指令",
    },

    /* ==================== 移动文件弹窗 ==================== */
    moveFileModal: {
        vaultRoot: "仓库根目录",
        ariaLabel: "移动当前文件到目录",
        title: "移动当前文件到目录",
        titleSelection: "移动 {{count}} 个项目到目录",
        placeholder: "搜索目标目录...",
        ariaLabelSelection: "移动选中项目到目录",
        selectionSummary: "{{count}} 个项目",
        noMatch: "无匹配目录",
    },

    /* ==================== DockviewLayout ==================== */
    dockview: {
        settingsTooltip: "设置",
        welcomeTitle: "欢迎使用 ofive",
        welcomeDesc: "请从左侧 Panel 打开文件，或通过扩展注册新的 Tab 组件。",
        activityBar: "活动栏",
        activityAlignTop: "向上对齐",
        activityAlignBottom: "向下对齐",
        activityHide: "隐藏",
        activityDeleteCustom: "删除自定义 Activity",
        activityCreateCustom: "创建自定义 Activity",
        sidebarEmpty: "该区域暂无面板，可从其他区域拖入。",
        leftPanelArea: "左侧扩展面板区",
        mainArea: "Dockview 主区域",
        rightPanelArea: "右侧扩展面板区",
    },

    /* ==================== 图片 ==================== */
    image: {
        loadFailed: "图片加载失败",
        loading: "图片加载中：{{src}}",
        loadError: "图片加载失败：{{src}}",
        renderFailed: "图片渲染失败",
        notFound: "未找到图片文件",
        unsupportedType: "不支持的图片类型: {{type}}",
    },

    /* ==================== frontmatter ==================== */
    frontmatter: {
        clickToEdit: "点击编辑",
        docSynced: "文档已同步，保存由统一调度负责",
        emptyFrontmatter: "当前 frontmatter 为空。",
        yamlError: "YAML 格式错误",
        editorClosed: "编辑器已关闭，无法同步。",
        noFrontmatterBlock: "未检测到 frontmatter 区块。",
        frontmatterSynced: "frontmatter 已同步到文档，保存由统一调度负责。",
    },

    /* ==================== Store 错误 ==================== */
    store: {
        loadConfigFailed: "加载配置失败",
        refreshConfigFailed: "后端配置刷新失败",
        saveSearchConfigFailed: "保存搜索配置失败",
        saveVimConfigFailed: "保存 Vim 配置失败",
        saveConfigFailed: "保存配置项 {{key}} 失败",
    },

    customActivity: {
        openCommand: "打开自定义 Activity 创建器",
        modalTitle: "创建自定义 Activity",
        modalSubtitle: "通过统一注册语义新增一个 activity icon，并可选择生成 panel 容器或绑定现有命令。",
        basicSection: "基础信息",
        nameLabel: "名称",
        namePlaceholder: "例如：今日任务",
        typeSection: "类型",
        panelType: "Panel 容器",
        panelTypeDesc: "点击 icon 后切换一个新的侧边栏 panel 容器。",
        callbackType: "Callback",
        callbackTypeDesc: "点击 icon 后执行一条已注册命令。",
        commandLabel: "绑定命令",
        iconSection: "图标",
        create: "创建",
        saving: "保存中...",
        nameRequired: "请输入 activity 名称。",
        commandRequired: "请选择需要绑定的命令。",
        saveFailed: "保存自定义 Activity 失败",
        deleteFailed: "删除自定义 Activity 失败",
    },

    /* ==================== 编辑器插件 ==================== */
    editorPlugins: {
        noMatchingNote: "没有匹配的笔记",
        fileReaderAbnormal: "FileReader result 格式异常",
        fileReaderFailed: "FileReader 读取失败",
    },
};

export default zh;
