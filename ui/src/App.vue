<template>
    <main class="app-shell">
        <header class="topbar">
            <div>
                <p class="eyebrow">iOS Battery Monitor</p>
                <h1>移动设备电池监控</h1>
            </div>
            <div class="top-actions">
                <button type="button" :aria-busy="isDiscovering" :disabled="actionsBusy" @click="discoverNow">
                    <span v-if="isDiscovering" class="button-spinner" aria-hidden="true"></span>
                    {{ isDiscovering ? '发现中...' : '发现设备' }}
                </button>
                <button
                    type="button"
                    class="primary"
                    :aria-busy="isCollecting"
                    :disabled="actionsBusy"
                    @click="collectNow"
                >
                    <span v-if="isCollecting" class="button-spinner" aria-hidden="true"></span>
                    {{ isCollecting ? '采集中...' : '立即采集' }}
                </button>
            </div>
        </header>

        <section class="status-strip" aria-label="服务状态">
            <div>
                <span class="dot" :class="status?.running ? 'online' : 'offline'"></span>
                <strong>{{ status?.running ? '服务运行中' : '服务未运行' }}</strong>
            </div>
            <div>
                已授权 <strong>{{ visibleDevices.length }}</strong>
            </div>
            <div>
                记录 <strong>{{ status?.readingCount ?? readings.length }}</strong>
            </div>
            <div>
                间隔 <strong>{{ collectionText }}</strong>
            </div>
        </section>

        <p v-if="error" class="error-banner">{{ error }}</p>
        <div
            v-if="actionFeedback.message"
            class="action-feedback"
            :class="`is-${actionFeedback.status}`"
            :role="actionFeedback.status === 'failed' ? 'alert' : 'status'"
            aria-live="polite"
        >
            <span class="action-feedback-indicator" aria-hidden="true"></span>
            <span class="action-feedback-message">{{ actionFeedback.message }}</span>
            <button type="button" class="action-feedback-close" aria-label="关闭通知" @click="dismissActionFeedback">
                ×
            </button>
        </div>

        <div class="layout">
            <aside class="sidebar" aria-label="设备列表">
                <div class="section-heading">
                    <div>
                        <h2>设备</h2>
                        <span>局域网与 USB 授权设备</span>
                    </div>
                </div>

                <div v-if="devices.length" class="device-list">
                    <button
                        v-for="device in devices"
                        :key="device.id"
                        type="button"
                        class="device-item"
                        :class="{ active: selectedDeviceId === device.id, 'offline-device': device.online === false }"
                        @click="
                            selectedDeviceId = device.id;
                            refreshReadings();
                        "
                    >
                        <span>
                            <strong>{{ device.name || device.deviceName || device.id }}</strong>
                            <small>{{ deviceSubtitle(device) }}</small>
                        </span>
                        <em>{{ deviceConnectionText(device) }}</em>
                    </button>
                </div>
                <div v-else class="empty-state">
                    {{ loading ? '正在读取设备...' : '暂无设备' }}
                </div>
            </aside>

            <section class="content">
                <section class="hero-panel">
                    <div>
                        <div class="device-title-row">
                            <h2>
                                {{
                                    activeDevice?.name ||
                                    activeDevice?.deviceName ||
                                    latestData.DeviceName ||
                                    '未选择设备'
                                }}
                            </h2>
                            <button
                                type="button"
                                class="raw-icon-action"
                                title="查看原始 JSON"
                                aria-label="查看原始 JSON"
                                @click="rawDialogOpen = true"
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <circle cx="11" cy="11" r="7"></circle>
                                    <path d="m16.5 16.5 4 4"></path>
                                </svg>
                            </button>
                        </div>
                        <p>{{ heroMetadataText }}</p>
                    </div>
                    <div class="health-ring">
                        <span>{{ healthPercent(latestData) }}</span>
                        <small>健康度评估</small>
                    </div>
                </section>

                <section class="metrics-grid" aria-label="关键指标">
                    <article
                        v-for="item in importantFields"
                        :key="item.key"
                        class="metric-card"
                        :class="metricCardClass(item)"
                    >
                        <span>{{ item.label }}</span>
                        <strong>{{ displayMetricValue(item, latestData) }}</strong>
                    </article>
                </section>

                <section class="charts-stack" aria-label="统计图">
                    <article v-for="chart in barCharts" :key="chart.key" class="chart-panel">
                        <div class="panel-heading">
                            <div class="panel-title">
                                <h2>{{ chart.label }}</h2>
                            </div>
                            <div class="chart-summary">
                                <strong>{{ chart.latestText }}</strong>
                            </div>
                        </div>
                        <div class="chart-toolbar">
                            <label>
                                <span>范围</span>
                                <select
                                    :value="chart.rangeKey"
                                    :aria-label="`${chart.label}时间范围`"
                                    @change="selectChartRange(chart.key, $event.target.value)"
                                >
                                    <option v-for="range in chart.rangeOptions" :key="range.key" :value="range.key">
                                        {{ range.label }}
                                    </option>
                                </select>
                            </label>
                        </div>

                        <div v-if="chart.displayPoints.length" class="chart-stage">
                            <svg
                                class="chart-svg"
                                :viewBox="`0 0 ${chart.width} ${chart.height}`"
                                preserveAspectRatio="xMidYMid meet"
                                role="img"
                                :aria-label="`${chart.label}趋势`"
                            >
                                <line
                                    v-for="grid in chart.gridLines"
                                    :key="`${chart.key}-${grid.y}`"
                                    class="grid-line"
                                    :x1="chart.padding.left"
                                    :x2="chart.width - chart.padding.right"
                                    :y1="grid.y"
                                    :y2="grid.y"
                                />
                                <text
                                    v-for="grid in chart.gridLines"
                                    :key="`${chart.key}-label-${grid.y}`"
                                    class="axis-label"
                                    x="12"
                                    :y="grid.y + 4"
                                >
                                    {{ grid.value }}
                                </text>

                                <g v-if="chart.mode === 'bar'">
                                    <g
                                        v-for="point in chart.displayPoints"
                                        :key="`${chart.key}-${pointKey(point)}`"
                                        class="chart-hover-target"
                                        @mouseenter="showTooltip(point, chart.key)"
                                        @mouseleave="hideTooltip"
                                    >
                                        <rect
                                            class="chart-bar-hit"
                                            :x="point.x - point.hitWidth / 2"
                                            :y="chart.padding.top"
                                            :width="point.hitWidth"
                                            :height="chart.height - chart.padding.top - chart.padding.bottom"
                                        />
                                        <rect
                                            class="chart-bar"
                                            :class="{ hovered: isHovered(point, chart.key) }"
                                            :x="point.x - point.barWidth / 2"
                                            :y="point.y"
                                            :width="point.barWidth"
                                            :height="Math.max(3, chart.height - chart.padding.bottom - point.y)"
                                            :fill="chart.color"
                                        />
                                    </g>
                                </g>

                                <g v-else>
                                    <path class="chart-line" :d="chart.d" :stroke="chart.color" />
                                    <g
                                        v-for="point in chart.displayPoints"
                                        :key="`${chart.key}-${pointKey(point)}`"
                                        class="chart-hover-target"
                                        @mouseenter="showTooltip(point, chart.key)"
                                        @mouseleave="hideTooltip"
                                    >
                                        <circle class="chart-point-hit" :cx="point.x" :cy="point.y" r="12" />
                                        <circle
                                            class="chart-point"
                                            :class="{ hovered: isHovered(point, chart.key) }"
                                            :cx="point.x"
                                            :cy="point.y"
                                            r="4.5"
                                            :fill="chart.color"
                                        />
                                    </g>
                                </g>
                                <text
                                    v-if="chart.labels[0]"
                                    class="axis-label"
                                    :x="chart.padding.left"
                                    :y="chart.height - 8"
                                >
                                    {{ chart.labels[0] }}
                                </text>
                                <text
                                    v-if="chart.labels[1]"
                                    class="axis-label axis-label-end"
                                    :x="chart.width - chart.padding.right"
                                    :y="chart.height - 8"
                                >
                                    {{ chart.labels[1] }}
                                </text>
                            </svg>
                            <div
                                v-if="hoverPoint?.chartKey === chart.key"
                                class="chart-tooltip"
                                :style="tooltipStyle()"
                            >
                                <strong>{{ hoverPoint.tooltipTitle }}</strong>
                                <span>{{ hoverPoint.timeText }}</span>
                                <span>变化 {{ hoverPoint.deltaText }}</span>
                            </div>
                            <div class="chart-axis-labels" aria-hidden="true">
                                <span
                                    v-for="grid in chart.gridLines"
                                    :key="`${chart.key}-html-label-${grid.y}`"
                                    :style="{ top: `${(grid.y / chart.height) * 100}%` }"
                                >
                                    {{ grid.value }}
                                </span>
                            </div>
                            <div class="chart-time-labels" aria-hidden="true">
                                <span>{{ chart.labels[0] }}</span>
                                <span>{{ chart.labels[1] }}</span>
                            </div>
                        </div>
                        <div v-else class="empty-chart">当前范围内没有可绘制数据</div>
                    </article>

                    <article class="chart-panel">
                        <div class="panel-heading">
                            <div class="panel-title">
                                <h2>电池容量</h2>
                            </div>
                            <div class="chart-summary">
                                <strong>{{ capacityChart.latestText }}</strong>
                            </div>
                        </div>
                        <div class="chart-toolbar">
                            <label>
                                <span>范围</span>
                                <select
                                    :value="capacityRangeKey"
                                    aria-label="电池容量时间范围"
                                    @change="selectChartRange('capacity', $event.target.value)"
                                >
                                    <option v-for="range in LONG_RANGE_OPTIONS" :key="range.key" :value="range.key">
                                        {{ range.label }}
                                    </option>
                                </select>
                            </label>
                            <div class="legend">
                                <span v-for="series in capacityChartSeries" :key="series.key">
                                    <i :style="{ background: series.color }"></i>{{ series.label }}
                                </span>
                            </div>
                        </div>

                        <div v-if="capacityChart.paths.length" class="chart-stage capacity-stage">
                            <svg
                                class="chart-svg"
                                :viewBox="`0 0 ${capacityChart.width} ${capacityChart.height}`"
                                preserveAspectRatio="xMidYMid meet"
                                role="img"
                                aria-label="电池容量趋势"
                            >
                                <line
                                    v-for="grid in capacityChart.gridLines"
                                    :key="`capacity-${grid.y}`"
                                    class="grid-line"
                                    :x1="capacityChart.padding.left"
                                    :x2="capacityChart.width - capacityChart.padding.right"
                                    :y1="grid.y"
                                    :y2="grid.y"
                                />
                                <text
                                    v-for="grid in capacityChart.gridLines"
                                    :key="`capacity-label-${grid.y}`"
                                    class="axis-label"
                                    x="12"
                                    :y="grid.y + 4"
                                >
                                    {{ grid.value }}
                                </text>
                                <g v-for="path in capacityChart.paths" :key="path.key">
                                    <path class="chart-line" :d="path.d" :stroke="path.color" />
                                    <g
                                        v-for="point in path.points"
                                        :key="`${path.key}-${pointKey(point)}`"
                                        class="chart-hover-target"
                                        @mouseenter="showTooltip(point, 'capacity')"
                                        @mouseleave="hideTooltip"
                                    >
                                        <circle class="chart-point-hit" :cx="point.x" :cy="point.y" r="12" />
                                        <circle
                                            class="chart-point"
                                            :class="{ hovered: isHovered(point, 'capacity') }"
                                            :cx="point.x"
                                            :cy="point.y"
                                            r="4"
                                            :fill="path.color"
                                        />
                                    </g>
                                </g>
                                <text
                                    v-if="capacityChart.labels[0]"
                                    class="axis-label"
                                    :x="capacityChart.padding.left"
                                    :y="capacityChart.height - 8"
                                >
                                    {{ capacityChart.labels[0] }}
                                </text>
                                <text
                                    v-if="capacityChart.labels[1]"
                                    class="axis-label axis-label-end"
                                    :x="capacityChart.width - capacityChart.padding.right"
                                    :y="capacityChart.height - 8"
                                >
                                    {{ capacityChart.labels[1] }}
                                </text>
                            </svg>
                            <div
                                v-if="hoverPoint?.chartKey === 'capacity'"
                                class="chart-tooltip"
                                :style="tooltipStyle()"
                            >
                                <strong>{{ hoverPoint.tooltipTitle }}</strong>
                                <span>{{ hoverPoint.timeText }}</span>
                                <span>变化 {{ hoverPoint.deltaText }}</span>
                            </div>
                            <div class="chart-axis-labels" aria-hidden="true">
                                <span
                                    v-for="grid in capacityChart.gridLines"
                                    :key="`capacity-html-label-${grid.y}`"
                                    :style="{ top: `${(grid.y / capacityChart.height) * 100}%` }"
                                >
                                    {{ grid.value }}
                                </span>
                            </div>
                            <div class="chart-time-labels" aria-hidden="true">
                                <span>{{ capacityChart.labels[0] }}</span>
                                <span>{{ capacityChart.labels[1] }}</span>
                            </div>
                        </div>
                        <div v-else class="empty-chart">当前范围内没有容量数据</div>
                    </article>
                </section>
            </section>
        </div>

        <div v-if="rawDialogOpen" class="modal-backdrop" @click.self="rawDialogOpen = false">
            <section class="json-modal" role="dialog" aria-modal="true" aria-label="原始 JSON">
                <header class="modal-heading">
                    <div>
                        <h2>原始 JSON</h2>
                        <p>{{ latestReading ? formatTime(latestReading.timestamp) : '暂无采样' }}</p>
                    </div>
                    <button type="button" class="icon-button" aria-label="关闭" @click="rawDialogOpen = false">
                        ×
                    </button>
                </header>
                <pre>{{ formattedRawJson }}</pre>
            </section>
        </div>
    </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const SHORT_RANGE_OPTIONS = [
    { key: '1d', label: '近 1 天', ms: 24 * 60 * 60 * 1000 },
    { key: '3d', label: '近 3 天', ms: 3 * 24 * 60 * 60 * 1000 },
    { key: '7d', label: '近 7 天', ms: 7 * 24 * 60 * 60 * 1000 },
];

const LONG_RANGE_OPTIONS = [
    { key: '7d', label: '近 7 天', ms: 7 * 24 * 60 * 60 * 1000 },
    { key: '30d', label: '近 30 天', ms: 30 * 24 * 60 * 60 * 1000 },
    { key: '90d', label: '近 90 天', ms: 90 * 24 * 60 * 60 * 1000 },
];

const RANGE_OPTIONS = [...SHORT_RANGE_OPTIONS, ...LONG_RANGE_OPTIONS.filter(range => range.key !== '7d')];

const importantFields = [
    { key: 'StateOfCharge', label: '当前电量', layout: 'featured', unit: '%', variant: 'charge' },
    { key: 'CycleCount', label: '循环次数', unit: '', variant: 'cycle' },
    {
        fallbackKey: 'Voltage',
        key: 'AppleRawBatteryVoltage',
        label: '当前电压',
        transform: 'voltage',
        variant: 'voltage',
    },
    { key: 'Temperature', label: '温度', transform: 'celsius', unit: '°C', variant: 'temperature' },
    { key: 'NominalChargeCapacity', label: '当前容量', unit: 'mAh', variant: 'capacity' },
    { key: 'FullChargeCapacity', label: '满充容量', unit: 'mAh', variant: 'capacity' },
    { key: 'QmaxCell0', label: 'Qmax 容量', unit: 'mAh', variant: 'capacity' },
    { key: 'DesignCapacity', label: '出厂容量', layout: 'wide', unit: 'mAh', variant: 'capacity' },
];

const barMetricDefinitions = [
    {
        color: '#16a34a',
        fixedMax: 100,
        fixedMin: 0,
        format: value => `${Math.round(value)}%`,
        key: 'charge',
        label: '实时电量',
        unit: '%',
        value: data => numeric(data.StateOfCharge),
    },
    {
        color: '#2563eb',
        fixedMax: 100,
        fixedMin: 0,
        format: value => `${value.toFixed(1)}%`,
        key: 'health',
        label: '健康度评估',
        unit: '%',
        value: data => {
            const nominal = numeric(data.NominalChargeCapacity);
            const design = numeric(data.DesignCapacity);
            return nominal && design ? (nominal / design) * 100 : null;
        },
    },
    {
        color: '#f97316',
        format: value => `${value.toFixed(1)} °C`,
        key: 'temperature',
        label: '温度',
        unit: '°C',
        value: data => {
            const raw = numeric(data.Temperature);
            return raw === null ? null : raw / 100;
        },
    },
];

const capacityChartSeries = [
    { color: '#2563eb', key: 'NominalChargeCapacity', label: '当前容量', unit: 'mAh' },
    { color: '#0f9f8f', key: 'FullChargeCapacity', label: '满充容量', unit: 'mAh' },
    { color: '#7c3aed', key: 'QmaxCell0', label: 'Qmax 容量', unit: 'mAh' },
];

const status = ref(null);
const devices = ref([]);
const readings = ref([]);
const selectedDeviceId = ref('');
const chargeRangeKey = ref('1d');
const healthRangeKey = ref('7d');
const temperatureRangeKey = ref('1d');
const capacityRangeKey = ref('7d');
const loading = ref(true);
const error = ref('');
const eventSource = ref(null);
const rawDialogOpen = ref(false);
const hoverPoint = ref(null);
const displayTarget = ref(160);
const activeAction = ref('');
const actionFeedback = ref({ message: '', status: 'idle', type: '' });

const filteredReadings = computed(() => {
    if (!selectedDeviceId.value) return readings.value;
    return readings.value.filter(
        reading => reading.udid === selectedDeviceId.value || reading.device_id === selectedDeviceId.value
    );
});

const latestReading = computed(() => {
    const list = filteredReadings.value;
    return list.length ? list[list.length - 1] : null;
});

const latestData = computed(() => latestReading.value?.data || {});

const activeDevice = computed(() => {
    if (!selectedDeviceId.value) return devices.value[0] || null;
    return devices.value.find(device => device.id === selectedDeviceId.value) || null;
});

const visibleDevices = computed(() => status.value?.visibleDevices || []);
const formattedRawJson = computed(() => JSON.stringify(latestData.value || {}, null, 2));
const actionsBusy = computed(() => Boolean(activeAction.value));
const isCollecting = computed(() => activeAction.value === 'collect');
const isDiscovering = computed(() => activeAction.value === 'discover');
const heroMetadataText = computed(() => {
    const parts = [
        deviceModelText(activeDevice.value, latestData.value),
        latestReading.value ? formatTime(latestReading.value.timestamp) : '暂无采样',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : '-';
});

const collectionText = computed(() => {
    const interval = status.value?.collectionInterval;
    if (!interval) return '-';
    return `${Math.round(interval / 60)} 分钟`;
});

const maxSelectedRange = computed(() => {
    const selectedKeys = [
        chargeRangeKey.value,
        healthRangeKey.value,
        temperatureRangeKey.value,
        capacityRangeKey.value,
    ];
    return (
        selectedKeys
            .map(key => rangeByKey(key))
            .filter(Boolean)
            .sort((a, b) => b.ms - a.ms)[0] || LONG_RANGE_OPTIONS[0]
    );
});

const barCharts = computed(() =>
    barMetricDefinitions.map(definition => {
        const rangeKey = chartRangeRef(definition.key).value;
        return {
            ...buildSingleMetricChart(
                readingsForRange(filteredReadings.value, rangeKey),
                definition,
                displayTarget.value
            ),
            rangeKey,
            rangeLabel: rangeByKey(rangeKey)?.label || '',
            rangeOptions: chartRangeOptions(definition.key),
        };
    })
);

const capacityChart = computed(() => ({
    ...buildCapacityChart(
        readingsForRange(filteredReadings.value, capacityRangeKey.value),
        capacityChartSeries,
        displayTarget.value
    ),
    rangeKey: capacityRangeKey.value,
    rangeLabel: rangeByKey(capacityRangeKey.value)?.label || '',
}));

const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
};

const refreshStatus = async () => {
    status.value = await fetchJson('/api/status');
};

const refreshDevices = async () => {
    const payload = await fetchJson('/api/devices');
    devices.value = payload.devices || [];
    if (!selectedDeviceId.value && devices.value.length) {
        selectedDeviceId.value = devices.value[0].id;
    }
};

const refreshReadings = async () => {
    const now = Date.now();
    const params = new URLSearchParams({
        from: new Date(now - maxSelectedRange.value.ms).toISOString(),
        limit: '20000',
        to: new Date(now).toISOString(),
    });
    if (selectedDeviceId.value) params.set('deviceId', selectedDeviceId.value);
    const payload = await fetchJson(`/api/readings?${params.toString()}`);
    readings.value = payload.readings || [];
    hoverPoint.value = null;
};

const refreshAll = async () => {
    loading.value = true;
    try {
        await Promise.all([refreshStatus(), refreshDevices()]);
        await refreshReadings();
        error.value = '';
    } catch (err) {
        error.value = err.message || String(err);
    } finally {
        loading.value = false;
    }
};

const selectChartRange = async (chartKey, key) => {
    chartRangeRef(chartKey).value = key;
    await refreshReadings();
};

const collectNow = async () => {
    if (actionsBusy.value) return;
    activeAction.value = 'collect';
    setActionFeedback('collect', 'pending', '正在采集已发现设备的电池数据...');
    try {
        error.value = '';
        const payload = await fetchJson('/api/collect', { method: 'POST' });
        await refreshAll();
        const count = payload.readings?.length || 0;
        if (status.value?.lastError) {
            const message = formatActionError(status.value.lastError);
            error.value = status.value.lastError;
            setActionFeedback(
                'collect',
                count ? 'warning' : 'failed',
                count ? `采集完成 ${count} 条记录，但有设备失败：${message}` : `采集失败：${message}`
            );
            return;
        }
        setActionFeedback('collect', 'success', count ? `采集完成：新增 ${count} 条记录` : '采集完成：没有新增记录');
    } catch (err) {
        const message = err.message || String(err);
        error.value = message;
        setActionFeedback('collect', 'failed', `采集失败：${formatActionError(message)}`);
    } finally {
        activeAction.value = '';
    }
};

const discoverNow = async () => {
    if (actionsBusy.value) return;
    activeAction.value = 'discover';
    setActionFeedback('discover', 'pending', '正在发现 USB 与局域网设备...');
    try {
        error.value = '';
        const payload = await fetchJson('/api/discover', { method: 'POST' });
        await refreshAll();
        const count = payload.devices?.length ?? visibleDevices.value.length;
        setActionFeedback(
            'discover',
            'success',
            count ? `发现完成：找到 ${count} 台在线设备` : '发现完成：未找到在线设备'
        );
    } catch (err) {
        const message = err.message || String(err);
        error.value = message;
        setActionFeedback('discover', 'failed', `发现失败：${formatActionError(message)}`);
    } finally {
        activeAction.value = '';
    }
};

const setActionFeedback = (type, statusText, message) => {
    actionFeedback.value = { message, status: statusText, type };
};

const dismissActionFeedback = () => {
    actionFeedback.value = { message: '', status: 'idle', type: '' };
};

const formatActionError = message => {
    const text = String(message || '').trim();
    if (!text) return '未知错误';
    const firstLine = text.split(/\r?\n/).find(Boolean) || text;
    return firstLine.length > 180 ? `${firstLine.slice(0, 180)}...` : firstLine;
};

const connectEvents = () => {
    const source = new EventSource('/api/events');
    eventSource.value = source;
    const update = async () => {
        await refreshStatus();
        await refreshDevices();
        await refreshReadings();
    };
    source.addEventListener('devices', update);
    source.addEventListener('readings', update);
    source.addEventListener('error', event => {
        try {
            const payload = JSON.parse(event.data);
            error.value = payload?.payload?.message || '';
            refreshStatus();
        } catch {
            error.value = event.data;
        }
    });
};

const updateDisplayTarget = () => {
    displayTarget.value = window.innerWidth < 760 ? 80 : 160;
};

const numeric = value => {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const rangeByKey = key => {
    return RANGE_OPTIONS.find(range => range.key === key) || null;
};

const chartRangeRef = chartKey => {
    if (chartKey === 'charge') return chargeRangeKey;
    if (chartKey === 'health') return healthRangeKey;
    if (chartKey === 'temperature') return temperatureRangeKey;
    return capacityRangeKey;
};

const chartRangeOptions = chartKey => {
    return chartKey === 'health' || chartKey === 'capacity' ? LONG_RANGE_OPTIONS : SHORT_RANGE_OPTIONS;
};

const readingsForRange = (rows, rangeKey) => {
    const range = rangeByKey(rangeKey);
    if (!range) return rows;
    const from = Date.now() - range.ms;
    return rows.filter(reading => {
        const time = new Date(reading.timestamp).getTime();
        return Number.isFinite(time) && time >= from;
    });
};

const deviceConnectionText = device => {
    if (device?.online === false) return '离线';
    return formatConnectionText(
        device?.connection_label || device?.connections?.join(' + ') || device?.connection || ''
    );
};

const deviceSubtitle = device => {
    return deviceModelText(device) || '未知型号';
};

const deviceModelText = (device, data = {}) => {
    return (
        device?.product_type ||
        device?.ProductType ||
        data?.ProductType ||
        data?.product_type ||
        device?.productVersion ||
        device?.product_version ||
        data?.ProductVersion ||
        data?.product_version ||
        ''
    );
};

const formatConnectionText = value => {
    if (!value) return '';
    if (value === '离线') return value;
    return String(value)
        .split('+')
        .map(part => part.trim().toUpperCase())
        .filter(Boolean)
        .join(' + ');
};

const formatValue = (value, unit = '') => {
    if (value === null || value === undefined || value === '') return '-';
    if (Array.isArray(value)) return `[${value.join(', ')}]`;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const text = Math.abs(value) >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
        return `${text}${unit ? ` ${unit}` : ''}`;
    }
    return `${value}${unit ? ` ${unit}` : ''}`;
};

const displayMetricValue = (item, data) => {
    const value = data[item.key] ?? data[item.fallbackKey];
    if (item.transform === 'celsius') return formatTemperature(value);
    if (item.transform === 'health') return healthPercent(data);
    if (item.transform === 'voltage') return formatVoltage(value);
    return formatValue(value, item.unit);
};

const metricCardClass = item => [
    item.layout ? `metric-card--${item.layout}` : null,
    item.variant ? `metric-card--${item.variant}` : null,
];

const formatTemperature = value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return `${(value / 100).toFixed(1)} °C`;
};

const formatVoltage = value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    const volts = Math.abs(value) > 100 ? value / 1000 : value;
    return `${volts.toFixed(2)} V`;
};

const formatTime = value => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        month: '2-digit',
    }).format(date);
};

const formatFullTime = timeMs => {
    return new Intl.DateTimeFormat('zh-CN', {
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        month: '2-digit',
    }).format(new Date(timeMs));
};

const healthPercent = data => {
    const nominal = data?.NominalChargeCapacity;
    const design = data?.DesignCapacity;
    if (!nominal || !design) return '-';
    return `${((nominal / design) * 100).toFixed(1)}%`;
};

const pointKey = point => {
    return `${point.timeMs}:${point.value}:${point.index}`;
};

const sortAndDedupe = points => {
    const seen = new Set();
    return points
        .filter(point => {
            const key = pointKey(point);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
};

const dedupeMetricPoints = points => {
    const seen = new Set();
    return points.filter(point => {
        const key = `${point.timeMs}:${point.label}:${point.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const representativePoints = (points, target) => {
    if (points.length <= target) return points;
    let bucketCount = Math.max(1, Math.ceil(target / 4));
    let selected = [];
    for (let pass = 0; pass < 6; pass += 1) {
        selected = sampleBuckets(points, bucketCount);
        if (selected.length <= target || bucketCount <= 1) break;
        bucketCount = Math.max(1, Math.floor(bucketCount * 0.72));
    }
    if (selected.length <= target) return selected;
    return sortAndDedupe(selected.filter((_, index) => index % Math.ceil(selected.length / target) === 0)).slice(
        0,
        target
    );
};

const sampleBuckets = (points, bucketCount) => {
    const minTime = points[0].timeMs;
    const maxTime = points.at(-1).timeMs;
    const span = Math.max(1, maxTime - minTime);
    const buckets = Array.from({ length: bucketCount }, () => []);
    for (const point of points) {
        const bucketIndex = Math.min(bucketCount - 1, Math.floor(((point.timeMs - minTime) / span) * bucketCount));
        buckets[bucketIndex].push(point);
    }
    const selected = [];
    for (const bucket of buckets) {
        if (!bucket.length) continue;
        const first = bucket[0];
        const last = bucket.at(-1);
        let min = first;
        let max = first;
        for (const point of bucket) {
            if (point.value < min.value) min = point;
            if (point.value > max.value) max = point;
        }
        selected.push(first, last, min, max);
    }
    return sortAndDedupe(selected);
};

const pointsFromReadings = (readingRows, definition) => {
    return readingRows
        .map((reading, index) => {
            const timeMs = new Date(reading.timestamp).getTime();
            const value = definition.value(reading.data || {});
            if (!Number.isFinite(timeMs) || typeof value !== 'number' || !Number.isFinite(value)) return null;
            return {
                color: definition.color,
                formattedValue: definition.format(value),
                index,
                label: definition.label,
                rawReading: reading,
                timeMs,
                timestamp: reading.timestamp,
                unit: definition.unit,
                value,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.timeMs - b.timeMs || a.index - b.index)
        .filter((point, index, all) => {
            const previous = all[index - 1];
            return !previous || point.timeMs !== previous.timeMs || point.value !== previous.value;
        })
        .map((point, index, all) => {
            const previous = all[index - 1];
            const delta = previous ? point.value - previous.value : null;
            return {
                ...point,
                delta,
                deltaText: formatDelta(delta, definition.unit, definition.key === 'charge' ? 0 : 1),
            };
        });
};

const formatDelta = (delta, unit, fractionDigits = 1) => {
    if (delta === null || delta === undefined) return '暂无变化';
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(fractionDigits)}${unit}`;
};

const buildScale = (points, fixedMin, fixedMax, padding, width, height) => {
    const values = points.map(point => point.value);
    let min = fixedMin ?? Math.min(...values);
    let max = fixedMax ?? Math.max(...values);
    if (!values.length) {
        min = 0;
        max = 1;
    } else if (min === max) {
        min -= 1;
        max += 1;
    }
    const minTime = Math.min(...points.map(point => point.timeMs));
    const maxTime = Math.max(...points.map(point => point.timeMs));
    const xFor = time => {
        if (minTime === maxTime) return padding.left + (width - padding.left - padding.right) / 2;
        return padding.left + ((time - minTime) / (maxTime - minTime)) * (width - padding.left - padding.right);
    };
    const yFor = value => padding.top + (1 - (value - min) / (max - min)) * (height - padding.top - padding.bottom);
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
        value: Math.round(max - ratio * (max - min)),
        y: padding.top + ratio * (height - padding.top - padding.bottom),
    }));
    const labels = points.length ? [formatFullTime(points[0].timeMs), formatFullTime(points.at(-1).timeMs)] : [];
    return { gridLines, labels, max, maxTime, min, minTime, xFor, yFor };
};

const buildSingleMetricChart = (readingRows, definition, target) => {
    const rawPoints = dedupeMetricPoints(pointsFromReadings(readingRows, definition));
    const displayPoints = representativePoints(rawPoints, target);
    const mode = 'bar';
    const width = 760;
    const height = 190;
    const padding = { bottom: 32, left: target <= 80 ? 112 : 58, right: 28, top: 18 };
    const scale = buildScale(displayPoints, definition.fixedMin, definition.fixedMax, padding, width, height);
    const usableWidth = width - padding.left - padding.right;
    const slotWidth = usableWidth / Math.max(1, displayPoints.length);
    const points = displayPoints.map((point, index) => ({
        ...point,
        chartHeight: height,
        tooltipTitle: `${point.label} · ${point.formattedValue}`,
        x: padding.left + slotWidth * (index + 0.5),
        y: scale.yFor(point.value),
    }));
    for (const point of points) {
        point.barWidth = Math.max(3, Math.min(104, slotWidth * 0.86));
        point.hitWidth = Math.min(slotWidth, Math.max(point.barWidth + 4, slotWidth * 0.9));
    }
    const d = points
        .map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(' ');
    const latest = rawPoints.at(-1);
    const previous = rawPoints.length > 1 ? rawPoints.at(-2) : null;
    const delta = latest && previous ? latest.value - previous.value : null;
    return {
        ...definition,
        d,
        deltaText: formatDelta(delta, definition.unit, definition.key === 'charge' ? 0 : 1),
        displayPoints: points,
        gridLines: scale.gridLines,
        height,
        labels: scale.labels,
        latestText: latest ? definition.format(latest.value) : '-',
        mode,
        padding,
        rawPoints,
        width,
    };
};

const buildCapacityChart = (readingRows, series, target) => {
    const definitions = series.map(item => ({
        ...item,
        format: value => `${Math.round(value)} ${item.unit}`,
        value: data => numeric(data[item.key]),
    }));
    const rawBySeries = definitions.map(definition => ({
        ...definition,
        rawPoints: dedupeMetricPoints(pointsFromReadings(readingRows, definition)),
    }));
    const allRawPoints = rawBySeries.flatMap(item => item.rawPoints);
    const width = 760;
    const height = 300;
    const padding = { bottom: 32, left: target <= 80 ? 112 : 58, right: 28, top: 18 };
    if (!allRawPoints.length) {
        return { deltaText: '暂无变化', gridLines: [], height, labels: [], latestText: '-', padding, paths: [], width };
    }
    const perSeriesTarget = Math.max(24, Math.floor(target / Math.max(1, rawBySeries.length)));
    const sampledBySeries = rawBySeries.map(item => ({
        ...item,
        displayPoints: representativePoints(item.rawPoints, perSeriesTarget),
    }));
    const allDisplayPoints = sampledBySeries.flatMap(item => item.displayPoints);
    const scale = buildScale(allDisplayPoints, null, null, padding, width, height);
    const paths = sampledBySeries.map(item => {
        const points = item.displayPoints.map(point => ({
            ...point,
            chartHeight: height,
            color: item.color,
            label: item.label,
            tooltipTitle: `${item.label} · ${item.format(point.value)}`,
            x: scale.xFor(point.timeMs),
            y: scale.yFor(point.value),
        }));
        const d = points
            .map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
            .join(' ');
        return { ...item, d, points };
    });
    const nominalPoints = rawBySeries.find(item => item.key === 'NominalChargeCapacity')?.rawPoints || [];
    const latest = nominalPoints.at(-1);
    const previous = nominalPoints.length > 1 ? nominalPoints.at(-2) : null;
    const delta = latest && previous ? latest.value - previous.value : null;
    return {
        deltaText: formatDelta(delta, 'mAh', 0),
        gridLines: scale.gridLines,
        height,
        labels: scale.labels,
        latestText: latest ? `${Math.round(latest.value)} mAh` : '-',
        padding,
        paths,
        width,
    };
};

const showTooltip = (point, chartKey) => {
    hoverPoint.value = {
        ...point,
        chartKey,
        deltaText: point.deltaText || '暂无变化',
        timeText: formatFullTime(point.timeMs),
    };
};

const hideTooltip = () => {
    hoverPoint.value = null;
};

const isHovered = (point, chartKey) => {
    return (
        hoverPoint.value?.chartKey === chartKey &&
        hoverPoint.value?.timeMs === point.timeMs &&
        hoverPoint.value?.label === point.label &&
        hoverPoint.value?.value === point.value
    );
};

const tooltipStyle = () => {
    const point = hoverPoint.value;
    if (!point) return {};
    return {
        left: `${Math.min(78, Math.max(12, (point.x / 760) * 100))}%`,
        top: `${Math.min(68, Math.max(18, (point.y / (point.chartHeight || 300)) * 100))}%`,
    };
};

onMounted(async () => {
    updateDisplayTarget();
    window.addEventListener('resize', updateDisplayTarget);
    await refreshAll();
    connectEvents();
    window.setInterval(refreshAll, 30000);
});

onBeforeUnmount(() => {
    if (eventSource.value) eventSource.value.close();
    window.removeEventListener('resize', updateDisplayTarget);
});
</script>
