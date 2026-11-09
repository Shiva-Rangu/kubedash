package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/yaml"
)

type ClusterEnv struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Version  string `json:"version"`
	Status   string `json:"status"`
	Nodes    int    `json:"nodes"`
}

type NodeMetric struct {
	Name       string `json:"name"`
	Role       string `json:"role"`
	Status     string `json:"status"`
	CPUUsage   int    `json:"cpuUsage"`
	MemUsage   int    `json:"memUsage"`
	CPUCores   int    `json:"cpuCores"`
	MemoryGB   int    `json:"memoryGB"`
	HourlyCost string `json:"hourlyCost"`
}

type PodSummary struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Phase     string `json:"phase"`
	PodIP     string `json:"podIP"`
	NodeName  string `json:"nodeName"`
	Restarts  int32  `json:"restarts"`
	CPU       string `json:"cpu"`
	Memory    string `json:"memory"`
	Age       string `json:"age"`
}

type DepSummary struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Kind      string `json:"kind"`
	Replicas  int32  `json:"replicas"`
	Ready     int32  `json:"ready"`
	Available int32  `json:"available"`
	Image     string `json:"image"`
}

type ClusterEvent struct {
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Object    string `json:"object"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type UserAccount struct {
	Username   string `json:"username"`
	Team       string `json:"team"`
	Role       string `json:"role"`
	AuthType   string `json:"authType"`
	SourceType string `json:"sourceType"` // Guided Form, ActiveDirectory, Git, Helm, YAML
}

type RBACRoleDef struct {
	Name      string   `json:"name"`
	Scope     string   `json:"scope"` // ClusterRole or Role
	APIGroups []string `json:"apiGroups"`
	Resources []string `json:"resources"`
	Verbs     []string `json:"verbs"`
}

type LDAPConfig struct {
	ServerURL    string `json:"serverUrl"`
	BindDN       string `json:"bindDN"`
	UserSearchOU string `json:"userSearchOU"`
	GroupSearchOU string `json:"groupSearchOU"`
	AutoSync     bool   `json:"autoSync"`
	LastSync     string `json:"lastSync"`
	SyncedGroups int    `json:"syncedGroups"`
}

type AuditLog struct {
	Timestamp string `json:"timestamp"`
	User      string `json:"user"`
	Action    string `json:"action"`
	Resource  string `json:"resource"`
	Status    string `json:"status"`
}

type ProjectGroup struct {
	Name        string   `json:"name"`
	Team        string   `json:"team"`
	Namespaces  []string `json:"namespaces"`
	CPUQuota    string   `json:"cpuQuota"`
	MemoryQuota string   `json:"memoryQuota"`
}

type GitOpsApp struct {
	Name       string `json:"name"`
	Engine     string `json:"engine"`
	RepoURL    string `json:"repoUrl"`
	Branch     string `json:"branch"`
	Path       string `json:"path"`
	SyncStatus string `json:"syncStatus"`
	Health     string `json:"health"`
	LastCommit string `json:"lastCommit"`
	AutoSync   bool   `json:"autoSync"`
}

type HelmRelease struct {
	ReleaseName string `json:"releaseName"`
	Chart       string `json:"chart"`
	Version     string `json:"version"`
	Namespace   string `json:"namespace"`
	Status      string `json:"status"`
	Updated     string `json:"updated"`
}

type GovernancePolicy struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Enforced    bool   `json:"enforced"`
	DriftStatus string `json:"driftStatus"`
	TargetFleet string `json:"targetFleet"`
}

type ImageScan struct {
	Image        string `json:"image"`
	Registry     string `json:"registry"`
	CurrentTag   string `json:"currentTag"`
	LatestTag    string `json:"latestTag"`
	UpdateAvail  bool   `json:"updateAvail"`
	CriticalCVEs int    `json:"criticalCVEs"`
	HighCVEs     int    `json:"highCVEs"`
	ScanStatus   string `json:"scanStatus"`
}

type StoragePVC struct {
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	StorageClass string `json:"storageClass"`
	Capacity     string `json:"capacity"`
	Status       string `json:"status"`
}

type PortForwardTunnel struct {
	ID         string `json:"id"`
	Service    string `json:"service"`
	Namespace  string `json:"namespace"`
	LocalPort  int    `json:"localPort"`
	TargetPort int    `json:"targetPort"`
	Status     string `json:"status"`
}

// --- Batch 3: Plugin & Extension Model ---
type DashboardPlugin struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Vendor      string `json:"vendor"`
	Version     string `json:"version"`
	Category    string `json:"category"` // FinOps, ServiceMesh, Chaos, Backup, Virtualization
	Description string `json:"description"`
	Installed   bool   `json:"installed"`
	WidgetData  string `json:"widgetData"`
}

type Server struct {
	mockMode       bool
	mu             sync.Mutex
	clusters       []ClusterEnv
	mockNodes      []NodeMetric
	mockPods       []PodSummary
	mockDeps       []DepSummary
	mockEvents     []ClusterEvent
	users          []UserAccount
	rbacRoles      []RBACRoleDef
	ldapConfig     LDAPConfig
	auditLogs      []AuditLog
	projects       []ProjectGroup
	syslogServer   string
	gitopsApps     []GitOpsApp
	gitCredentials []string
	itsmWindowOpen bool
	enforceGitOnly bool
	helmReleases   []HelmRelease
	policies       []GovernancePolicy
	imageScans     []ImageScan
	pvcs           []StoragePVC
	portForwards   []PortForwardTunnel
	plugins        []DashboardPlugin
	clientset      *kubernetes.Clientset
	dynamic        dynamic.Interface
	discovery      discovery.DiscoveryInterface
}

func newEnterpriseMockServer() *Server {
	return &Server{
		mockMode:       true,
		syslogServer:   "udp://syslog.corp.internal:514",
		itsmWindowOpen: true,
		enforceGitOnly: false,
		clusters: []ClusterEnv{
			{ID: "prod-eks-us", Name: "prod-us-east-eks", Provider: "AWS EKS", Version: "v1.31.2", Status: "Healthy", Nodes: 3},
			{ID: "stage-aks-eu", Name: "staging-eu-aks", Provider: "Azure AKS", Version: "v1.30.4", Status: "Healthy", Nodes: 2},
			{ID: "edge-talos-01", Name: "edge-omni-talos", Provider: "Talos Omni", Version: "v1.31.0", Status: "Healthy", Nodes: 4},
		},
		mockNodes: []NodeMetric{
			{Name: "control-plane-01", Role: "control-plane", Status: "Ready", CPUUsage: 34, MemUsage: 52, CPUCores: 8, MemoryGB: 32, HourlyCost: "$0.38/hr"},
			{Name: "worker-node-01", Role: "worker", Status: "Ready", CPUUsage: 68, MemUsage: 74, CPUCores: 16, MemoryGB: 64, HourlyCost: "$0.76/hr"},
			{Name: "worker-node-02", Role: "worker", Status: "Ready", CPUUsage: 41, MemUsage: 48, CPUCores: 16, MemoryGB: 64, HourlyCost: "$0.76/hr"},
		},
		mockPods: []PodSummary{
			{Name: "api-gateway-7f8b9c-x92k1", Namespace: "default", Phase: "Running", PodIP: "10.244.0.14", NodeName: "worker-node-01", Restarts: 0, CPU: "145m", Memory: "256Mi", Age: "4h22m"},
			{Name: "redis-cluster-0", Namespace: "default", Phase: "Running", PodIP: "10.244.0.18", NodeName: "worker-node-01", Restarts: 0, CPU: "85m", Memory: "512Mi", Age: "2d11h"},
			{Name: "payment-worker-5d4c-k88j2", Namespace: "default", Phase: "CrashLoopBackOff", PodIP: "10.244.2.09", NodeName: "worker-node-02", Restarts: 6, CPU: "15m", Memory: "64Mi", Age: "18m"},
			{Name: "coredns-66bcf65-zp9q1", Namespace: "kube-system", Phase: "Running", PodIP: "10.244.0.02", NodeName: "control-plane-01", Restarts: 0, CPU: "45m", Memory: "128Mi", Age: "14d"},
		},
		mockDeps: []DepSummary{
			{Name: "api-gateway", Namespace: "default", Kind: "Deployment", Replicas: 2, Ready: 2, Available: 2, Image: "ghcr.io/org/api-gateway:v2.4.1"},
			{Name: "payment-worker", Namespace: "default", Kind: "Deployment", Replicas: 1, Ready: 0, Available: 0, Image: "ghcr.io/org/payment:v1.1.0"},
			{Name: "redis-cluster", Namespace: "default", Kind: "StatefulSet", Replicas: 3, Ready: 3, Available: 3, Image: "redis:7.2-alpine"},
			{Name: "node-exporter", Namespace: "kube-system", Kind: "DaemonSet", Replicas: 3, Ready: 3, Available: 3, Image: "prom/node-exporter:v1.8.1"},
		},
		mockEvents: []ClusterEvent{
			{Type: "Warning", Reason: "BackOff", Object: "Pod/payment-worker-5d4c-k88j2", Message: "Back-off restarting failed container: missing DB_PASSWORD env secret", Timestamp: "2m ago"},
			{Type: "Normal", Reason: "Scheduled", Object: "Pod/api-gateway-7f8b9c-x92k1", Message: "Successfully assigned default/api-gateway to worker-node-01", Timestamp: "14m ago"},
		},
		users: []UserAccount{
			{Username: "shiva.admin", Team: "Platform-Engineering", Role: "ClusterAdmin", AuthType: "OIDC / Okta SSO", SourceType: "Guided Form"},
			{Username: "priya.devops", Team: "Payments-Squad", Role: "DevOps-Lead", AuthType: "ActiveDirectory / LDAP", SourceType: "AD Auto-Sync"},
			{Username: "gitops-bot", Team: "Platform-Engineering", Role: "GitOps-Deployer", AuthType: "ServiceAccount Token", SourceType: "Helm Chart"},
		},
		rbacRoles: []RBACRoleDef{
			{Name: "ClusterAdmin", Scope: "ClusterRole", APIGroups: []string{"*"}, Resources: []string{"*"}, Verbs: []string{"*"}},
			{Name: "DevOps-Lead", Scope: "ClusterRole", APIGroups: []string{"", "apps", "batch"}, Resources: []string{"pods", "deployments", "statefulsets", "jobs"}, Verbs: []string{"get", "list", "watch", "create", "update", "patch", "delete"}},
			{Name: "Developer-Viewer", Scope: "Role", APIGroups: []string{"", "apps"}, Resources: []string{"pods", "pods/log", "deployments", "services"}, Verbs: []string{"get", "list", "watch"}},
		},
		ldapConfig: LDAPConfig{
			ServerURL:     "ldaps://ad.corp.internal:636",
			BindDN:        "CN=svc-k8s-ldap,OU=ServiceAccounts,DC=corp,DC=internal",
			UserSearchOU:  "OU=Engineering,DC=corp,DC=internal",
			GroupSearchOU: "OU=K8sSecurityGroups,DC=corp,DC=internal",
			AutoSync:      true,
			LastSync:      "10 mins ago",
			SyncedGroups:  4,
		},
		projects: []ProjectGroup{
			{Name: "Core-FinTech-Platform", Team: "Payments-Squad", Namespaces: []string{"default", "payments"}, CPUQuota: "16 Cores", MemoryQuota: "32 GiB"},
			{Name: "Cluster-Infrastructure", Team: "Platform-Engineering", Namespaces: []string{"kube-system", "gitops"}, CPUQuota: "32 Cores", MemoryQuota: "64 GiB"},
		},
		auditLogs: []AuditLog{
			{Timestamp: time.Now().Add(-15 * time.Minute).Format("15:04:05"), User: "shiva.admin", Action: "SSO_LOGIN", Resource: "Cluster/prod-us-east-eks", Status: "SUCCESS"},
		},
		gitopsApps: []GitOpsApp{
			{Name: "fintech-core-stack", Engine: "ArgoCD", RepoURL: "https://github.com/org/k8s-fleet-manifests", Branch: "main", Path: "overlays/prod", SyncStatus: "Synced", Health: "Healthy", LastCommit: "a91f4c2 (Webhook Auto-Sync)", AutoSync: true},
			{Name: "payment-mesh-config", Engine: "FluxCD", RepoURL: "https://github.com/org/payment-gitops", Branch: "release/v2", Path: "clusters/eks", SyncStatus: "OutOfSync", Health: "Degraded", LastCommit: "7b3e110 (Pending ITSM Gate)", AutoSync: true},
		},
		gitCredentials: []string{"github-enterprise-ssh-key (Shared)", "gitlab-deploy-token-prod (Shared)"},
		helmReleases: []HelmRelease{
			{ReleaseName: "kube-prometheus-stack", Chart: "prometheus-community/kube-prometheus-stack", Version: "61.3.0", Namespace: "kube-system", Status: "deployed", Updated: "2d ago"},
			{ReleaseName: "ingress-nginx", Chart: "ingress-nginx/ingress-nginx", Version: "4.11.1", Namespace: "default", Status: "deployed", Updated: "5d ago"},
		},
		policies: []GovernancePolicy{
			{ID: "pol-1", Name: "Enforce Restricted Pod Security Standard (Disallow Privileged)", Category: "PodSecurity", Enforced: true, DriftStatus: "Compliant", TargetFleet: "All Clusters"},
			{ID: "pol-2", Name: "Require Namespace ResourceQuotas & LimitRanges", Category: "Quota", Enforced: true, DriftStatus: "Drifted (1 Namespace)", TargetFleet: "prod-us-east-eks"},
			{ID: "pol-3", Name: "Block 'latest' Container Image Tags & Require Signed Images", Category: "ImagePolicy", Enforced: true, DriftStatus: "Drifted (payment-worker)", TargetFleet: "All Clusters"},
		},
		imageScans: []ImageScan{
			{Image: "ghcr.io/org/api-gateway", Registry: "GitHub Container Registry", CurrentTag: "v2.4.1", LatestTag: "v2.5.0", UpdateAvail: true, CriticalCVEs: 0, HighCVEs: 1, ScanStatus: "Passed"},
			{Image: "ghcr.io/org/payment", Registry: "GitHub Container Registry", CurrentTag: "v1.1.0", LatestTag: "v1.2.1", UpdateAvail: true, CriticalCVEs: 2, HighCVEs: 4, ScanStatus: "Action Required"},
			{Image: "redis", Registry: "DockerHub Official", CurrentTag: "7.2-alpine", LatestTag: "7.2-alpine", UpdateAvail: false, CriticalCVEs: 0, HighCVEs: 0, ScanStatus: "Clean"},
		},
		pvcs: []StoragePVC{
			{Name: "redis-data-redis-cluster-0", Namespace: "default", StorageClass: "gp3-encrypted", Capacity: "50Gi", Status: "Bound"},
			{Name: "prometheus-tsdb-volume", Namespace: "kube-system", StorageClass: "gp3-encrypted", Capacity: "200Gi", Status: "Bound"},
		},
		portForwards: []PortForwardTunnel{
			{ID: "pf-1", Service: "api-gateway-lb", Namespace: "default", LocalPort: 9090, TargetPort: 80, Status: "Active (127.0.0.1:9090)"},
		},
		plugins: []DashboardPlugin{
			{ID: "plug-kubecost", Name: "OpenCost / Kubecost FinOps", Vendor: "CNCF OpenCost", Version: "v2.3.0", Category: "FinOps", Description: "Real-time cost allocation by namespace, deployment, and cloud billing API.", Installed: true, WidgetData: "Idle Cluster Waste: $142/mo | Spot Instance Savings: $410/mo"},
			{ID: "plug-istio", Name: "Istio Service Mesh Telemetry", Vendor: "Istio Ecosystem", Version: "v1.23.1", Category: "ServiceMesh", Description: "mTLS traffic topology, golden signals (p99 latency), and circuit breakers.", Installed: true, WidgetData: "mTLS Strict Mode: 100% Pods | Mesh p99 Latency: 4.2ms | 5xx Rate: 0.01%"},
			{ID: "plug-velero", Name: "Velero Cluster Backup & DR", Vendor: "VMware Tanzu", Version: "v1.14.0", Category: "Backup", Description: "Scheduled etcd & PVC volume snapshots to AWS S3 / Azure Blob.", Installed: false, WidgetData: "Last Nightly Snapshot: S3://k8s-backups/prod-eks (RPO: 15m)"},
			{ID: "plug-chaos", Name: "Chaos Mesh Resilience Studio", Vendor: "CNCF Chaos Mesh", Version: "v2.6.3", Category: "Chaos", Description: "Inject pod failure, network latency, and node drain experiments safely.", Installed: false, WidgetData: "3 Resilience Experiments Ready (PodKill, NetworkCorrupt, StressCPU)"},
			{ID: "plug-kubevirt", Name: "KubeVirt Virtual Machine Manager", Vendor: "CNCF KubeVirt", Version: "v1.3.0", Category: "Virtualization", Description: "Run and live-migrate legacy Windows/Linux VMs alongside Kubernetes pods.", Installed: false, WidgetData: "2 VirtualMachineInstances running on worker-node-01"},
		},
	}
}

func (s *Server) recordAudit(user, action, resource, status string) {
	s.auditLogs = append([]AuditLog{{
		Timestamp: time.Now().Format("15:04:05"),
		User:      user,
		Action:    action,
		Resource:  resource,
		Status:    status,
	}}, s.auditLogs...)
}

func initKubeConfig() (*rest.Config, error) {
	if os.Getenv("MOCK_MODE") == "true" {
		return nil, fmt.Errorf("MOCK_MODE enabled")
	}
	if config, err := rest.InClusterConfig(); err == nil {
		return config, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	kubeconfig := filepath.Join(home, ".kube", "config")
	info, err := os.Stat(kubeconfig)
	if err != nil || info.IsDir() {
		return nil, fmt.Errorf("no valid kubeconfig at %s", kubeconfig)
	}
	return clientcmd.BuildConfigFromFlags("", kubeconfig)
}

func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"nodeCount":      len(s.mockNodes),
		"namespaceCount": 4,
		"totalPods":      len(s.mockPods),
		"namespaces":     []string{"default", "kube-system", "gitops", "payments"},
		"monthlyCostEst": "$1,368.00 / mo",
		"clusters":       s.clusters,
		"nodes":          s.mockNodes,
		"events":         s.mockEvents,
		"projects":       s.projects,
	})
}

func (s *Server) handleClusters(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Name     string `json:"name"`
			Provider string `json:"provider"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		s.clusters = append(s.clusters, ClusterEnv{
			ID: fmt.Sprintf("cluster-%d", len(s.clusters)+1), Name: req.Name, Provider: req.Provider, Version: "v1.31.2", Status: "Healthy", Nodes: 3,
		})
		s.recordAudit("shiva.admin", "PROVISION_OR_IMPORT_CLUSTER", req.Name+" ("+req.Provider+")", "SUCCESS")
	}
	writeJSON(w, http.StatusOK, s.clusters)
}

func (s *Server) handlePods(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if ns == "" {
		ns = "default"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodGet {
		var out []PodSummary
		for _, p := range s.mockPods {
			if p.Namespace == ns {
				out = append(out, p)
			}
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	if r.Method == http.MethodDelete {
		name := r.URL.Query().Get("name")
		var updated []PodSummary
		for _, p := range s.mockPods {
			if !(p.Name == name && p.Namespace == ns) {
				updated = append(updated, p)
			}
		}
		s.mockPods = updated
		s.recordAudit("shiva.admin", "DELETE_POD", ns+"/"+name, "SUCCESS")
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	}
}

func (s *Server) handleDeployments(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if ns == "" {
		ns = "default"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodGet {
		var out []DepSummary
		for _, d := range s.mockDeps {
			if d.Namespace == ns {
				out = append(out, d)
			}
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	if r.Method == http.MethodPost {
		if s.enforceGitOnly {
			s.recordAudit("shiva.admin", "MANUAL_CHANGE_BLOCKED", "Enforce Git-Only Policy Active", "DENIED")
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Blocked by Fleet Policy: Code-based GitOps deployment only is enforced."})
			return
		}
		var req struct {
			Action    string `json:"action"`
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
			Replicas  int32  `json:"replicas"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		for i := range s.mockDeps {
			if s.mockDeps[i].Name == req.Name && s.mockDeps[i].Namespace == req.Namespace {
				if req.Action == "scale" {
					s.mockDeps[i].Replicas = req.Replicas
					s.mockDeps[i].Ready = req.Replicas
					s.mockDeps[i].Available = req.Replicas
					s.recordAudit("shiva.admin", "SCALE_WORKLOAD", fmt.Sprintf("%s/%s -> %d", req.Namespace, req.Name, req.Replicas), "SUCCESS")
				} else if req.Action == "restart" {
					s.recordAudit("shiva.admin", "ROLLING_RESTART", req.Namespace+"/"+req.Name, "SUCCESS")
				}
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
	}
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	pod := r.URL.Query().Get("pod")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if strings.Contains(pod, "payment") {
		fmt.Fprintf(w, "[%s] ERROR Starting payment-worker in %s\n", time.Now().Add(-2*time.Minute).Format(time.RFC3339), ns)
		fmt.Fprintf(w, "[%s] FATAL Environment variable DB_PASSWORD is not set in Secret 'payment-db-secret'\n", time.Now().Format(time.RFC3339))
		return
	}
	fmt.Fprintf(w, "[%s] INFO Container %s healthy in namespace %s\n", time.Now().Format(time.RFC3339), pod, ns)
}

func (s *Server) handleTerminalExec(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pod     string `json:"pod"`
		Command string `json:"command"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s.mu.Lock()
	s.recordAudit("shiva.admin", "CONTAINER_EXEC", fmt.Sprintf("%s (%s)", req.Pod, req.Command), "SUCCESS")
	s.mu.Unlock()
	cmd := strings.TrimSpace(req.Command)
	output := fmt.Sprintf("Executed inside %s: %s (exit code 0)", req.Pod, cmd)
	if cmd == "kubectl get pods" {
		output = "NAME                          READY   STATUS    RESTARTS   AGE\napi-gateway-7f8b9c-x92k1      1/1     Running   0          4h\nredis-cluster-0               1/1     Running   0          2d"
	}
	writeJSON(w, http.StatusOK, map[string]string{"output": output})
}

// Upgraded Batch 3 IAM Endpoint: Users, Guided RBAC Role Builder, Active Directory Sync
func (s *Server) handleIAM(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Action     string      `json:"action"` // "create_user", "create_role", "ad_sync", "update_ldap"
			User       UserAccount `json:"user"`
			RoleDef    RBACRoleDef `json:"roleDef"`
			LDAP       LDAPConfig  `json:"ldap"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		switch req.Action {
		case "create_user":
			if req.User.SourceType == "" {
				req.User.SourceType = "Guided Form"
			}
			s.users = append(s.users, req.User)
			s.recordAudit("shiva.admin", "PROVISION_USER_TEAM", fmt.Sprintf("%s (%s via %s)", req.User.Username, req.User.Role, req.User.SourceType), "SUCCESS")
		case "create_role":
			s.rbacRoles = append(s.rbacRoles, req.RoleDef)
			s.recordAudit("shiva.admin", "CREATE_RBAC_ROLE", fmt.Sprintf("%s (%s)", req.RoleDef.Name, req.RoleDef.Scope), "SUCCESS")
		case "ad_sync":
			s.ldapConfig.LastSync = "Just now"
			s.ldapConfig.SyncedGroups++
			newADUser := fmt.Sprintf("ad.engineer.%d", len(s.users)+1)
			s.users = append(s.users, UserAccount{
				Username:   newADUser,
				Team:       "Cloud-SRE-AD-Group",
				Role:       "DevOps-Lead",
				AuthType:   "ActiveDirectory / LDAP",
				SourceType: "AD Auto-Sync",
			})
			s.recordAudit("system.ldap", "ACTIVE_DIRECTORY_SYNC", "Synced OU=K8sSecurityGroups (+1 User/Group)", "SUCCESS")
		case "update_ldap":
			s.ldapConfig = req.LDAP
			s.ldapConfig.LastSync = "Config Updated"
			s.recordAudit("shiva.admin", "UPDATE_LDAP_CONFIG", req.LDAP.ServerURL, "SUCCESS")
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users":        s.users,
		"rbacRoles":    s.rbacRoles,
		"ldapConfig":   s.ldapConfig,
		"auditLogs":    s.auditLogs,
		"syslogServer": s.syslogServer,
		"ssoProviders": []string{"Okta OIDC (Active)", "Microsoft Entra ID / AD Sync (Active)", "GitHub Enterprise OAuth (Configured)", "Keycloak SAML 2.0 (Standby)"},
	})
}

// Batch 3 Endpoint: Custom Plugins & Extensions Marketplace
func (s *Server) handlePlugins(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Action      string          `json:"action"` // "toggle" or "register"
			ID          string          `json:"id"`
			CustomPlugin DashboardPlugin `json:"customPlugin"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Action == "toggle" {
			for i := range s.plugins {
				if s.plugins[i].ID == req.ID {
					s.plugins[i].Installed = !s.plugins[i].Installed
					state := "INSTALLED"
					if !s.plugins[i].Installed {
						state = "DISABLED"
					}
					s.recordAudit("shiva.admin", "PLUGIN_"+state, s.plugins[i].Name, "SUCCESS")
				}
			}
		} else if req.Action == "register" {
			req.CustomPlugin.ID = fmt.Sprintf("plug-custom-%d", len(s.plugins)+1)
			req.CustomPlugin.Installed = true
			if req.CustomPlugin.WidgetData == "" {
				req.CustomPlugin.WidgetData = "Custom Extension Telemetry Active: Status 200 OK"
			}
			s.plugins = append(s.plugins, req.CustomPlugin)
			s.recordAudit("shiva.admin", "REGISTER_CUSTOM_EXTENSION", req.CustomPlugin.Name, "SUCCESS")
		}
	}
	writeJSON(w, http.StatusOK, s.plugins)
}

func (s *Server) handleAIAssistant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Prompt string `json:"prompt"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	p := strings.ToLower(req.Prompt)
	reply := "✅ **AI Cluster Summary:** 3 Clusters Healthy. 1 Pod (`payment-worker`) in CrashLoopBackOff due to missing `DB_PASSWORD`, and 2 Critical CVEs detected in `ghcr.io/org/payment:v1.1.0`."
	if strings.Contains(p, "crash") || strings.Contains(p, "payment") {
		reply = "🔍 **Root Cause (`payment-worker-5d4c-k88j2`):** Missing secret key `DB_PASSWORD` + image `v1.1.0` has 2 Critical CVEs. Upgrade to `v1.2.1` in the Security tab and create the secret."
	}
	writeJSON(w, http.StatusOK, map[string]string{"reply": reply})
}

func (s *Server) handleGitOps(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Action  string `json:"action"`
			Name    string `json:"name"`
			Engine  string `json:"engine"`
			RepoURL string `json:"repoUrl"`
			Branch  string `json:"branch"`
			Path    string `json:"path"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		switch req.Action {
		case "sync":
			if !s.itsmWindowOpen {
				s.recordAudit("shiva.admin", "GITOPS_SYNC_BLOCKED", "ITSM Change Freeze Window Active", "DENIED")
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Blocked by ITSM Change Window Gate: Maintenance window is currently CLOSED."})
				return
			}
			for i := range s.gitopsApps {
				if s.gitopsApps[i].Name == req.Name {
					s.gitopsApps[i].SyncStatus = "Synced"
					s.gitopsApps[i].Health = "Healthy"
					s.gitopsApps[i].LastCommit = "f82c901 (Manual Webhook Sync)"
				}
			}
			s.recordAudit("shiva.admin", "GITOPS_SYNC", req.Name, "SUCCESS")
		case "toggle_itsm":
			s.itsmWindowOpen = !s.itsmWindowOpen
			s.recordAudit("shiva.admin", "TOGGLE_ITSM_GATE", fmt.Sprintf("Window Open=%v", s.itsmWindowOpen), "SUCCESS")
		case "toggle_gitonly":
			s.enforceGitOnly = !s.enforceGitOnly
			s.recordAudit("shiva.admin", "TOGGLE_GIT_ONLY_POLICY", fmt.Sprintf("Enforce=%v", s.enforceGitOnly), "SUCCESS")
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"apps":           s.gitopsApps,
		"credentials":    s.gitCredentials,
		"itsmWindowOpen": s.itsmWindowOpen,
		"enforceGitOnly": s.enforceGitOnly,
	})
}

func (s *Server) handleHelm(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			ReleaseName string `json:"releaseName"`
			Chart       string `json:"chart"`
			Version     string `json:"version"`
			Namespace   string `json:"namespace"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		s.helmReleases = append(s.helmReleases, HelmRelease{
			ReleaseName: req.ReleaseName, Chart: req.Chart, Version: req.Version, Namespace: req.Namespace, Status: "deployed", Updated: "Just now",
		})
		s.recordAudit("shiva.admin", "HELM_INSTALL", req.ReleaseName+" ("+req.Chart+")", "SUCCESS")
	}
	writeJSON(w, http.StatusOK, s.helmReleases)
}

func (s *Server) handleGovernance(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Action string `json:"action"`
			ID     string `json:"id"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		for i := range s.policies {
			if s.policies[i].ID == req.ID {
				if req.Action == "remediate" {
					s.policies[i].DriftStatus = "Compliant (Auto-Remediated)"
					s.recordAudit("shiva.admin", "REMEDIATE_POLICY_DRIFT", s.policies[i].Name, "SUCCESS")
				} else if req.Action == "toggle" {
					s.policies[i].Enforced = !s.policies[i].Enforced
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, s.policies)
}

func (s *Server) handleSecurity(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Image string `json:"image"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		for i := range s.imageScans {
			if s.imageScans[i].Image == req.Image {
				s.imageScans[i].CurrentTag = s.imageScans[i].LatestTag
				s.imageScans[i].UpdateAvail = false
				s.imageScans[i].CriticalCVEs = 0
				s.imageScans[i].HighCVEs = 0
				s.imageScans[i].ScanStatus = "Patched & Verified"
				s.recordAudit("shiva.admin", "UPGRADE_CONTAINER_IMAGE", req.Image+":"+s.imageScans[i].LatestTag, "SUCCESS")
			}
		}
	}
	writeJSON(w, http.StatusOK, s.imageScans)
}

func (s *Server) handleNetStorage(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			Service    string `json:"service"`
			Namespace  string `json:"namespace"`
			LocalPort  int    `json:"localPort"`
			TargetPort int    `json:"targetPort"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		s.portForwards = append(s.portForwards, PortForwardTunnel{
			ID: fmt.Sprintf("pf-%d", len(s.portForwards)+1), Service: req.Service, Namespace: req.Namespace, LocalPort: req.LocalPort, TargetPort: req.TargetPort, Status: fmt.Sprintf("Active (127.0.0.1:%d)", req.LocalPort),
		})
		s.recordAudit("shiva.admin", "START_PORT_FORWARD", fmt.Sprintf("%s (%d->%d)", req.Service, req.LocalPort, req.TargetPort), "SUCCESS")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"pvcs":         s.pvcs,
		"portForwards": s.portForwards,
	})
}

func (s *Server) handleApplyYAML(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.itsmWindowOpen {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "ITSM Change Window is currently CLOSED. Open it in GitOps & Change Gates."})
		return
	}
	var payload struct {
		YAML string `json:"yaml"`
	}
	json.NewDecoder(r.Body).Decode(&payload)
	jsonBytes, err := yaml.YAMLToJSON([]byte(payload.YAML))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	obj := &unstructured.Unstructured{}
	json.Unmarshal(jsonBytes, &obj.Object)
	name := obj.GetName()
	kind := obj.GetKind()
	s.recordAudit("shiva.admin", "APPLY_YAML", fmt.Sprintf("%s/%s", kind, name), "SUCCESS")
	writeJSON(w, http.StatusOK, map[string]string{"status": "applied", "kind": kind, "name": name})
}

func main() {
	srv := newEnterpriseMockServer()
	if cfg, err := initKubeConfig(); err == nil {
		if cs, err := kubernetes.NewForConfig(cfg); err == nil {
			srv.clientset = cs
			srv.dynamic, _ = dynamic.NewForConfig(cfg)
			srv.discovery, _ = discovery.NewDiscoveryClientForConfig(cfg)
		}
	}

	http.HandleFunc("/api/overview", cors(srv.handleOverview))
	http.HandleFunc("/api/clusters", cors(srv.handleClusters))
	http.HandleFunc("/api/pods", cors(srv.handlePods))
	http.HandleFunc("/api/deployments", cors(srv.handleDeployments))
	http.HandleFunc("/api/logs", cors(srv.handleLogs))
	http.HandleFunc("/api/exec", cors(srv.handleTerminalExec))
	http.HandleFunc("/api/iam", cors(srv.handleIAM))
	http.HandleFunc("/api/plugins", cors(srv.handlePlugins))
	http.HandleFunc("/api/ai-assistant", cors(srv.handleAIAssistant))
	http.HandleFunc("/api/gitops", cors(srv.handleGitOps))
	http.HandleFunc("/api/helm", cors(srv.handleHelm))
	http.HandleFunc("/api/governance", cors(srv.handleGovernance))
	http.HandleFunc("/api/security", cors(srv.handleSecurity))
	http.HandleFunc("/api/network-storage", cors(srv.handleNetStorage))
	http.HandleFunc("/api/apply", cors(srv.handleApplyYAML))

	_ = context.Background
	_ = corev1.PodLogOptions{}
	_ = metav1.ListOptions{}
	_ = types.ApplyPatchType
	_ = memory.NewMemCacheClient
	_ = restmapper.NewDeferredDiscoveryRESTMapper
	_ = io.Copy

	staticDir := "./static"
	if _, err := os.Stat(staticDir); err == nil {
		http.Handle("/", http.FileServer(http.Dir(staticDir)))
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Enterprise Kubernetes Platform (Batch 3) listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
