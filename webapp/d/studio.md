<webui-data data-page-title="Studio" data-page-subtitle="Rig and animate"></webui-data>

<webui-restrict-to-role role="1">
    <template slot="valid">
        <app-cherub-studio></app-cherub-studio>
        <webui-page-help heading="Studio guide" storage-key="bluecherub-studio-help">
            <p>The same guide is on the <a href="/guide">Guide</a> page.</p>
            <webui-content src="/guide/studio-guide.md" nodetach></webui-content>
        </webui-page-help>
    </template>
    <template slot="invalid">
        <webui-quote theme="info">
            Sign in to use the Blue Cherub studio. It's free, with nothing behind a paywall.
        </webui-quote>
    </template>
</webui-restrict-to-role>
