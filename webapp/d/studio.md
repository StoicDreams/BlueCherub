<webui-data data-page-title="Studio" data-page-subtitle="Rig a character"></webui-data>

<webui-restrict-to-role role="1">
    <template slot="valid">
        <app-cherub-rigger></app-cherub-rigger>
    </template>
    <template slot="invalid">
        <webui-quote theme="info">
            Sign in to use the Blue Cherub studio. It's free, with nothing behind a paywall.
        </webui-quote>
    </template>
</webui-restrict-to-role>
