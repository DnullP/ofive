/**
 * @module plugins/calendar/calendarDateUtils
 * @description 日历日期工具：负责 frontmatter.date 归一化、月视图网格生成与每日笔记路径构建。
 * @dependencies
 *  - 无
 *
 * @example
 *   const dayKey = normalizeFrontmatterDateToDayKey("2024-07-09 09:30:00");
 *   const grid = buildCalendarMonthGrid(new Date());
 *
 * @exports
 *  - CalendarGridDay
 *  - toCalendarDayKey
 *  - normalizeFrontmatterDateToDayKey
 *  - buildCalendarMonthGrid
 *  - shiftCalendarMonth
 *  - buildDailyNoteRelativePath
 *  - buildDailyNoteInitialContent
 */

/**
 * @interface CalendarGridDay
 * @description 月视图中的单元格日期信息。
 */
export interface CalendarGridDay {
    /** 当天日期对象 */
    date: Date;
    /** YYYY-MM-DD 形式的日期键 */
    dayKey: string;
    /** 是否属于当前月份 */
    inCurrentMonth: boolean;
    /** 是否为今天 */
    isToday: boolean;
}

/**
 * @function padTwoDigits
 * @description 将数字填充为两位字符串。
 * @param value 数值。
 * @returns 两位字符串。
 */
function padTwoDigits(value: number): string {
    return String(value).padStart(2, "0");
}

/**
 * @function toCalendarDayKey
 * @description 将日期对象格式化为 YYYY-MM-DD 日期键。
 * @param date 日期对象。
 * @returns 日期键。
 */
export function toCalendarDayKey(date: Date): string {
    return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`;
}

/**
 * @function normalizeFrontmatterDateToDayKey
 * @description 将 frontmatter.date 的原始值归一化为 YYYY-MM-DD。
 * @param value 原始日期字符串。
 * @returns 合法日期键；无法识别时返回 null。
 */
export function normalizeFrontmatterDateToDayKey(value: string): string | null {
    const trimmed = value.trim();
    const matched = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!matched) {
        return null;
    }

    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    const normalizedDate = new Date(year, month - 1, day);
    if (
        normalizedDate.getFullYear() !== year ||
        normalizedDate.getMonth() !== month - 1 ||
        normalizedDate.getDate() !== day
    ) {
        return null;
    }

    return `${matched[1]}-${matched[2]}-${matched[3]}`;
}

/**
 * @function buildCalendarMonthGrid
 * @description 生成以周一为起始的 6x7 月视图网格。
 * @param anchorDate 当前月锚点日期。
 * @param today 用于标记今天的日期对象。
 * @returns 固定 42 个单元格的日期网格。
 */
export function buildCalendarMonthGrid(anchorDate: Date, today = new Date()): CalendarGridDay[] {
    const currentMonthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const firstWeekdayOffset = (currentMonthStart.getDay() + 6) % 7;
    const gridStartDate = new Date(
        currentMonthStart.getFullYear(),
        currentMonthStart.getMonth(),
        1 - firstWeekdayOffset,
    );
    const todayKey = toCalendarDayKey(today);

    return Array.from({ length: 42 }, (_, index) => {
        const currentDate = new Date(
            gridStartDate.getFullYear(),
            gridStartDate.getMonth(),
            gridStartDate.getDate() + index,
        );
        const dayKey = toCalendarDayKey(currentDate);
        return {
            date: currentDate,
            dayKey,
            inCurrentMonth: currentDate.getMonth() === anchorDate.getMonth(),
            isToday: dayKey === todayKey,
        };
    });
}

/**
 * @function shiftCalendarMonth
 * @description 按月偏移日历锚点。
 * @param anchorDate 当前锚点日期。
 * @param monthDelta 月偏移量。
 * @returns 偏移后的月起始日期。
 */
export function shiftCalendarMonth(anchorDate: Date, monthDelta: number): Date {
    return new Date(anchorDate.getFullYear(), anchorDate.getMonth() + monthDelta, 1);
}

/**
 * @function buildDailyNoteRelativePath
 * @description 生成每日笔记的默认相对路径。
 * @param dayKey YYYY-MM-DD 日期键。
 * @returns 默认每日笔记路径。
 */
export function buildDailyNoteRelativePath(dayKey: string): string {
    return `Daily/${dayKey}.md`;
}

/**
 * @function buildDailyNoteInitialContent
 * @description 生成每日笔记的默认内容，包含 frontmatter.date。
 * @param dayKey YYYY-MM-DD 日期键。
 * @returns 默认 Markdown 内容。
 */
export function buildDailyNoteInitialContent(dayKey: string): string {
    return `---\ndate: ${dayKey}\n---\n# ${dayKey}\n`;
}