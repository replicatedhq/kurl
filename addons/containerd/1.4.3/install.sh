
CONTAINERD_NEEDS_RESTART=0
function containerd_install() {
    local src="$DIR/addons/containerd/$CONTAINERD_VERSION"

    install_host_archives "$src" containerd.io
    case "$LSB_DIST" in
        centos|rhel|amzn|ol)
            yum_install_host_packages "$src" libzstd
            ;;
    esac
    chmod +x ${DIR}/addons/containerd/${CONTAINERD_VERSION}/assets/runc
    # If the runc binary is executing the cp command will fail with "text file busy" error.
    # Containerd uses runc in detached mode so any runc processes should be short-lived and exit
    # as soon as the container starts
    try_1m_stderr cp ${DIR}/addons/containerd/${CONTAINERD_VERSION}/assets/runc $(which runc)
    containerd_configure
    systemctl daemon-reload

    systemctl enable containerd

    containerd_configure_ctl "$src"

    # NOTE: this will not remove the proxy
    if [ -n "$PROXY_ADDRESS" ]; then
        containerd_configure_proxy
    fi

    if commandExists registry_containerd_configure && [ -n "$DOCKER_REGISTRY_IP" ]; then
        registry_containerd_configure "$DOCKER_REGISTRY_IP"
    fi

    if [ "$CONTAINERD_NEEDS_RESTART" = "1" ]; then
        restart_systemd_and_wait containerd
        CONTAINERD_NEEDS_RESTART=0
    fi

    load_images $src/images
}

function containerd_configure() {
    if [ -f /etc/containerd/config.toml ] && grep -q SystemdCgroup /etc/containerd/config.toml; then
        # Kurl config has already been applied. Leave the file as is to preserve end-user configs.
        return 0
    fi
    mkdir -p /etc/containerd
    containerd config default > /etc/containerd/config.toml

    sed -i '/systemd_cgroup/d' /etc/containerd/config.toml
    sed -i '/containerd.runtimes.runc.options/d' /etc/containerd/config.toml
    sed -i 's/level = ""/level = "warn"/' /etc/containerd/config.toml
    cat >> /etc/containerd/config.toml <<EOF
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
  SystemdCgroup = true
EOF

    CONTAINERD_NEEDS_RESTART=1
}

function containerd_configure_ctl() {
    local src="$1"

    if [ -e "/etc/crictl.yaml" ]; then
        return 0
    fi

    cp "$src/crictl.yaml" /etc/crictl.yaml
}

containerd_configure_proxy() {
    local previous_proxy="$(cat /etc/systemd/system/containerd.service.d/http-proxy.conf 2>/dev/null | grep -io 'https*_proxy=[^\" ]*' | awk 'BEGIN { FS="=" }; { print $2 }')"
    local previous_no_proxy="$(cat /etc/systemd/system/containerd.service.d/http-proxy.conf 2>/dev/null | grep -io 'no_proxy=[^\" ]*' | awk 'BEGIN { FS="=" }; { print $2 }')"
    if [ "$PROXY_ADDRESS" = "$previous_proxy" ] && [ "$NO_PROXY_ADDRESSES" = "$previous_no_proxy" ]; then
        return
    fi

    mkdir -p /etc/systemd/system/containerd.service.d
    local file=/etc/systemd/system/containerd.service.d/http-proxy.conf

    echo "# Generated by kURL" > $file
    echo "[Service]" >> $file

    if echo "$PROXY_ADDRESS" | grep -q "^https"; then
        echo "Environment=\"HTTPS_PROXY=${PROXY_ADDRESS}\" \"NO_PROXY=${NO_PROXY_ADDRESSES}\"" >> $file
    else
        echo "Environment=\"HTTP_PROXY=${PROXY_ADDRESS}\" \"NO_PROXY=${NO_PROXY_ADDRESSES}\"" >> $file
    fi

    CONTAINERD_NEEDS_RESTART=1
}
