import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, StatCard, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import {
  Truck,
  AlertTriangle,
  CheckCircle2,
  Package,
  Layers,
  ArrowRight,
  RefreshCw,
  Search,
  Eye,
  Factory,
  ShoppingCart,
  Clock,
  CheckCircle,
  FileText,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const FulfilmentPage = () => {
  const { hasRole, user } = useAuth();
  const navigate = useNavigate();

  const canDispatch = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);
  const canManageProduction = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR);

  const [activeTab, setActiveTab] = useState('ready'); // 'ready' | 'shortage' | 'all'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Dashboard stats
  const [summary, setSummary] = useState({
    total_approved_orders: 0,
    ready_to_dispatch_count: 0,
    stock_shortage_count: 0,
    pending_production_requirements: 0,
  });

  const [orders, setOrders] = useState([]);

  // Modals state
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Dispatch modal
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [dispatchOrderData, setDispatchOrderData] = useState(null);
  const [dispatchItems, setDispatchItems] = useState([]);
  const [carrierNo, setCarrierNo] = useState('TN-45-AT-2026');
  const [driverName, setDriverName] = useState('Verified Factory Logistics');
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [dispatching, setDispatching] = useState(false);

  // Production requirement details modal
  const [prodReqModalOpen, setProdReqModalOpen] = useState(false);
  const [prodReqDetails, setProdReqDetails] = useState(null);
  const [prodReqLoading, setProdReqLoading] = useState(false);
  const [initiatingRun, setInitiatingRun] = useState(false);
  const [procuringMaterialId, setProcuringMaterialId] = useState(null);

  const fetchFulfilmentData = async () => {
    try {
      setLoading(true);
      setError('');

      let tabParam = undefined;
      if (activeTab === 'ready') tabParam = 'ready_to_dispatch';
      else if (activeTab === 'shortage') tabParam = 'stock_shortage';

      const queryParams = new URLSearchParams();
      if (tabParam) queryParams.append('tab', tabParam);
      if (search.trim()) queryParams.append('search', search.trim());

      const res = await api.get(`/fulfilment?${queryParams.toString()}`);
      if (res.success && res.data) {
        setSummary(res.data.summary || {});
        setOrders(res.data.orders || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch fulfilment orders');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFulfilmentData();
  }, [activeTab]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchFulfilmentData();
  };

  // 1. View Order Fulfilment Details
  const handleViewDetails = async (orderId) => {
    try {
      setDetailsLoading(true);
      setSelectedOrder(null);
      setDetailsModalOpen(true);
      const res = await api.get(`/fulfilment/orders/${orderId}`);
      if (res.success && res.data) {
        setSelectedOrder(res.data);
      }
    } catch (err) {
      alert(`Failed to load order fulfilment details: ${err.message}`);
      setDetailsModalOpen(false);
    } finally {
      setDetailsLoading(false);
    }
  };

  // 2. Open Proceed to Dispatch Modal
  const handleOpenDispatch = async (orderId) => {
    try {
      setDispatching(false);
      const res = await api.get(`/fulfilment/orders/${orderId}`);
      if (res.success && res.data) {
        setDispatchOrderData(res.data);
        const initialItems = (res.data.items || []).map((it) => {
          const remaining = parseFloat(it.remaining_qty || 0);
          const available = parseFloat(it.available_stock_qty || 0);
          const maxDispatchable = Math.min(remaining, available);
          return {
            item_id: it.item_id,
            item_name: it.product_name,
            uom: it.uom_id,
            remaining_qty: remaining,
            available_stock: available,
            dispatched_qty: maxDispatchable,
          };
        });
        setDispatchItems(initialItems);
        setDispatchModalOpen(true);
      }
    } catch (err) {
      alert(`Error preparing dispatch: ${err.message}`);
    }
  };

  // Submit Dispatch
  const handleSubmitDispatch = async () => {
    if (!dispatchOrderData) return;

    const itemsPayload = [];
    for (const it of dispatchItems) {
      const qty = parseFloat(it.dispatched_qty || 0);
      if (qty < 0) {
        alert(`Invalid quantity for ${it.item_name}`);
        return;
      }
      if (qty > it.remaining_qty) {
        alert(`Quantity for ${it.item_name} cannot exceed remaining quantity (${it.remaining_qty})`);
        return;
      }
      if (qty > it.available_stock) {
        alert(`Quantity for ${it.item_name} exceeds available warehouse stock (${it.available_stock})`);
        return;
      }
      if (qty > 0) {
        itemsPayload.push({
          item_id: it.item_id,
          quantity: qty,
        });
      }
    }

    if (itemsPayload.length === 0) {
      alert('Please specify at least one item quantity to dispatch.');
      return;
    }

    try {
      setDispatching(true);
      const payload = {
        carrierOrVehicleNo: carrierNo,
        driverName: driverName,
        dispatchDate: dispatchDate,
        items: itemsPayload,
      };

      const res = await api.post(`/fulfilment/orders/${dispatchOrderData.salesOrderId}/dispatch`, payload);
      if (res.success) {
        alert(
          `Dispatch successful!\nDispatch Note: ${res.data.dispatchNumber}\nGST Tax Invoice: ${res.data.invoiceNumber}\nInventory updated and posted to accounting ledger.`
        );
        setDispatchModalOpen(false);
        fetchFulfilmentData();
      }
    } catch (err) {
      alert(`Dispatch failed: ${err.message}`);
    } finally {
      setDispatching(false);
    }
  };

  // 3. Open Production Requirement Details
  const handleOpenProductionRequirement = async (requirementId) => {
    try {
      setProdReqLoading(true);
      setProdReqDetails(null);
      setProdReqModalOpen(true);

      const res = await api.get(`/fulfilment/production-requirements/${requirementId}`);
      if (res.success && res.data) {
        setProdReqDetails(res.data);
      }
    } catch (err) {
      alert(`Failed to load production requirement details: ${err.message}`);
      setProdReqModalOpen(false);
    } finally {
      setProdReqLoading(false);
    }
  };

  // Initiate Production Run from Requirement
  const handleInitiateProduction = async () => {
    if (!prodReqDetails?.requirement) return;
    try {
      setInitiatingRun(true);
      const reqId = prodReqDetails.requirement.id;
      const res = await api.post(`/fulfilment/production-requirements/${reqId}/initiate-production`, {});
      if (res.success) {
        alert(`Production run created: ${res.data.productionRun?.run_number || 'OK'}.\nRequirement status updated to IN PRODUCTION.`);
        setProdReqModalOpen(false);
        fetchFulfilmentData();
        navigate('/production');
      }
    } catch (err) {
      alert(`Failed to initiate production run: ${err.message}`);
    } finally {
      setInitiatingRun(false);
    }
  };

  // Raise Procurement Requirement for Raw Material Shortage
  const handleRaiseProcurement = async (material) => {
    if (!prodReqDetails?.requirement) return;
    try {
      setProcuringMaterialId(material.material_item_id);
      const reqId = prodReqDetails.requirement.id;
      const payload = {
        material_item_id: material.material_item_id,
        shortage_qty: material.shortage_quantity,
        uom_id: material.uom_id,
        notes: `Procurement for Production Requirement #${prodReqDetails.requirement.requirement_number}`,
      };

      const res = await api.post(`/fulfilment/production-requirements/${reqId}/procure`, payload);
      if (res.success) {
        alert(`Procurement requirement raised for ${material.item_name} (${material.shortage_quantity} ${material.uom_id})!`);
        const refreshed = await api.get(`/fulfilment/production-requirements/${reqId}`);
        if (refreshed.success) setProdReqDetails(refreshed.data);
      }
    } catch (err) {
      alert(`Failed to raise procurement requirement: ${err.message}`);
    } finally {
      setProcuringMaterialId(null);
    }
  };

  const renderStatusBadge = (status) => {
    switch (status) {
      case 'ready_to_dispatch':
        return <Badge variant="success">Ready to Dispatch</Badge>;
      case 'stock_shortage':
        return <Badge variant="danger">Stock Shortage</Badge>;
      case 'partially_available':
        return <Badge variant="warning">Partially Available</Badge>;
      case 'fulfilled':
        return <Badge variant="primary">Fully Dispatched</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200/80 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Truck className="w-6 h-6 text-blue-600" />
            Order Fulfilment & Stock Availability
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time validation of Admin-approved Sales Orders against finished goods inventory, automated production requirements & dispatch workflow.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchFulfilmentData} loading={loading}>
            Refresh Stock
          </Button>
          {canManageProduction && (
            <Button variant="secondary" size="sm" icon={Factory} onClick={() => navigate('/production')}>
              Production Runs
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Orders in Fulfilment"
          value={summary.total_approved_orders || 0}
          icon={ShoppingCart}
          color="blue"
          subtitle="Admin approved or in progress"
        />
        <StatCard
          title="Ready to Dispatch"
          value={summary.ready_to_dispatch_count || 0}
          icon={CheckCircle2}
          color="green"
          subtitle="Sufficient stock available"
        />
        <StatCard
          title="Stock Shortages"
          value={summary.stock_shortage_count || 0}
          icon={AlertTriangle}
          color="rose"
          subtitle="Require manufacturing output"
        />
        <StatCard
          title="Production Requirements"
          value={summary.pending_production_requirements || 0}
          icon={Layers}
          color="amber"
          subtitle="Auto-generated requirements"
        />
      </div>

      {/* Main Fulfilment Table Card */}
      <Card>
        {/* Navigation Tabs & Search */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('ready')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${
                activeTab === 'ready'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Ready to Dispatch ({summary.ready_to_dispatch_count || 0})
            </button>

            <button
              onClick={() => setActiveTab('shortage')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${
                activeTab === 'shortage'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              Stock Shortage ({summary.stock_shortage_count || 0})
            </button>

            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'all'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Approved ({summary.total_approved_orders || 0})
            </button>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search Order # or Customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Filter
            </Button>
          </form>
        </div>

        {/* Content Section */}
        {loading ? (
          <LoadingSpinner text="Evaluating live finished goods inventory..." />
        ) : error ? (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm">{error}</div>
        ) : orders.length === 0 ? (
          <EmptyState
            message={
              activeTab === 'ready'
                ? 'No orders currently ready for dispatch. Check Stock Shortages or approve new sales orders.'
                : activeTab === 'shortage'
                ? 'No stock shortages detected! All approved orders have sufficient inventory.'
                : 'No approved sales orders found in fulfilment.'
            }
          />
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold text-xs uppercase tracking-wider">
                  <th className="py-3 px-4">Order #</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Ordered Qty</th>
                  <th className="py-3 px-4 text-right">Dispatched</th>
                  <th className="py-3 px-4 text-right">Remaining</th>
                  <th className="py-3 px-4 text-right">Stock Available</th>
                  <th className="py-3 px-4 text-right">Shortage</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((order) => {
                  const remaining = parseFloat(order.total_remaining_qty || 0);
                  const shortage = parseFloat(order.total_shortage_qty || 0);
                  const isReady = shortage === 0 && remaining > 0;
                  const isShortage = shortage > 0;

                  return (
                    <tr key={order.sales_order_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-blue-600">
                        {order.order_number}
                        {order.order_status === 'partially_dispatched' && (
                          <span className="block text-[10px] text-amber-600 font-medium">Partially Dispatched</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800">
                        {order.customer_name}
                        <span className="block text-xs text-slate-400">{order.customer_state_name}</span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                        {new Date(order.order_date).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-700">
                        {parseFloat(order.total_ordered_qty || 0).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right text-slate-500">
                        {parseFloat(order.total_dispatched_qty || 0).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                        {remaining.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium text-emerald-600">
                        {parseFloat(order.min_available_stock_qty || 0).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {shortage > 0 ? (
                          <span className="font-bold text-rose-600">{shortage.toLocaleString()}</span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {renderStatusBadge(order.fulfilment_status)}
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            icon={Eye}
                            onClick={() => handleViewDetails(order.sales_order_id)}
                          >
                            Details
                          </Button>

                          {isReady && canDispatch && (
                            <Button
                              variant="primary"
                              size="sm"
                              icon={Truck}
                              onClick={() => handleOpenDispatch(order.sales_order_id)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              Dispatch
                            </Button>
                          )}

                          {isShortage && order.active_production_requirement_id && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={Layers}
                              onClick={() => handleOpenProductionRequirement(order.active_production_requirement_id)}
                              className="border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100"
                            >
                              Production Req
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 1. ORDER FULFILMENT DETAILS MODAL */}
      <Modal
        isOpen={detailsModalOpen}
        onClose={() => setDetailsModalOpen(false)}
        title={`Order Fulfilment Details: ${selectedOrder?.orderNumber || ''}`}
        maxWidth="max-w-4xl"
      >
        {detailsLoading || !selectedOrder ? (
          <LoadingSpinner text="Fetching real-time inventory evaluation..." />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="text-xs text-slate-500 font-medium">Customer</span>
                <p className="font-semibold text-slate-800 text-sm">{selectedOrder.customerName}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Order Date</span>
                <p className="font-semibold text-slate-800 text-sm">
                  {new Date(selectedOrder.orderDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Remaining Quantity</span>
                <p className="font-bold text-blue-600 text-sm">{selectedOrder.totalRemainingQty}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Overall Status</span>
                <div className="mt-1">{renderStatusBadge(selectedOrder.overallStatus)}</div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-slate-800 text-sm mb-3">Item-Level Fulfilment Breakdown</h4>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600 text-xs font-semibold uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3 text-right">Ordered</th>
                      <th className="py-2.5 px-3 text-right">Dispatched</th>
                      <th className="py-2.5 px-3 text-right">Remaining</th>
                      <th className="py-2.5 px-3 text-right">Store Stock</th>
                      <th className="py-2.5 px-3 text-right">Shortage</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedOrder.items || []).map((it) => (
                      <tr key={it.item_id}>
                        <td className="py-2.5 px-3 font-medium text-slate-800">{it.product_name}</td>
                        <td className="py-2.5 px-3 text-right">{parseFloat(it.ordered_qty).toLocaleString()} {it.uom_id}</td>
                        <td className="py-2.5 px-3 text-right text-slate-500">{parseFloat(it.dispatched_qty).toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">{parseFloat(it.remaining_qty).toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-medium text-emerald-600">{parseFloat(it.available_stock_qty).toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right">
                          {parseFloat(it.shortage_qty) > 0 ? (
                            <span className="font-bold text-rose-600">{parseFloat(it.shortage_qty).toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {renderStatusBadge(it.line_status)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <Button variant="outline" onClick={() => setDetailsModalOpen(false)}>
                Close
              </Button>
              {selectedOrder.overallStatus === 'ready_to_dispatch' && canDispatch && (
                <Button
                  variant="primary"
                  icon={Truck}
                  onClick={() => {
                    setDetailsModalOpen(false);
                    handleOpenDispatch(selectedOrder.salesOrderId);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  Proceed to Dispatch
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 2. PROCEED TO DISPATCH MODAL */}
      <Modal
        isOpen={dispatchModalOpen}
        onClose={() => setDispatchModalOpen(false)}
        title={`Process Dispatch & Invoicing: ${dispatchOrderData?.orderNumber || ''}`}
        maxWidth="max-w-3xl"
      >
        <div className="space-y-6">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Audit Safety Note:</strong> Dispatched items will be deducted from inventory using FEFO batches, statutory GST invoice generated, and debit/credit entries posted to Accounts Receivable and Sales Revenue.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Carrier / Vehicle No</label>
              <input
                type="text"
                value={carrierNo}
                onChange={(e) => setCarrierNo(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. TN-45-AT-2026"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Driver Name / Transporter</label>
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Driver name"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Dispatch Date</label>
              <input
                type="date"
                value={dispatchDate}
                onChange={(e) => setDispatchDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-slate-800 text-sm mb-2">Quantities to Dispatch</h4>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600 text-xs font-semibold uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3 text-right">Remaining</th>
                    <th className="py-2.5 px-3 text-right">Available Stock</th>
                    <th className="py-2.5 px-3 text-right w-36">Dispatch Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dispatchItems.map((item, idx) => (
                    <tr key={item.item_id}>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {item.item_name} ({item.uom})
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 font-semibold">{item.remaining_qty}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-600 font-semibold">{item.available_stock}</td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max={Math.min(item.remaining_qty, item.available_stock)}
                          value={item.dispatched_qty}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const copy = [...dispatchItems];
                            copy[idx].dispatched_qty = val;
                            setDispatchItems(copy);
                          }}
                          className="w-28 px-2 py-1 text-right text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <Button variant="outline" onClick={() => setDispatchModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Truck}
              onClick={handleSubmitDispatch}
              loading={dispatching}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Confirm & Post Dispatch
            </Button>
          </div>
        </div>
      </Modal>

      {/* 3. PRODUCTION REQUIREMENT & BOM MATERIAL VALIDATION MODAL */}
      <Modal
        isOpen={prodReqModalOpen}
        onClose={() => setProdReqModalOpen(false)}
        title={`Production Requirement: ${prodReqDetails?.requirement?.requirement_number || ''}`}
        maxWidth="max-w-4xl"
      >
        {prodReqLoading || !prodReqDetails ? (
          <LoadingSpinner text="Checking Bill of Materials & store raw material inventory..." />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-amber-50/60 border border-amber-200 rounded-lg text-sm">
              <div>
                <span className="text-xs text-slate-500 font-medium">Target Product</span>
                <p className="font-bold text-slate-900">{prodReqDetails.requirement.product_name}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Sales Order</span>
                <p className="font-semibold text-blue-600">{prodReqDetails.requirement.sales_order_number}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Production Qty Needed</span>
                <p className="font-bold text-rose-600 text-base">
                  {prodReqDetails.requirement.production_qty_required} {prodReqDetails.requirement.uom_id}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Status</span>
                <p className="mt-0.5">
                  <Badge variant={prodReqDetails.requirement.status === 'fulfilled' ? 'success' : 'warning'}>
                    {prodReqDetails.requirement.status.toUpperCase()}
                  </Badge>
                </p>
              </div>
            </div>

            {prodReqDetails.bom ? (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                    <Factory className="w-4 h-4 text-blue-600" />
                    BOM Raw Material Availability Check
                  </h4>
                  <span className="text-xs text-slate-500">
                    BOM Code: <strong>{prodReqDetails.bom.bom_code}</strong> (Std Batch: {prodReqDetails.bom.standard_batch_size} {prodReqDetails.bom.batch_uom_id} | Planned Batches: <strong>{prodReqDetails.batchesNeeded}</strong>)
                  </span>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-slate-600 text-xs font-semibold uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Ingredient</th>
                        <th className="py-2.5 px-3 text-right">Std Qty</th>
                        <th className="py-2.5 px-3 text-right">Required Qty</th>
                        <th className="py-2.5 px-3 text-right">Available Stock</th>
                        <th className="py-2.5 px-3 text-right">Material Shortage</th>
                        <th className="py-2.5 px-3 text-center">Status</th>
                        <th className="py-2.5 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(prodReqDetails.materials || []).map((m) => {
                        const isShort = m.shortage_quantity > 0;
                        return (
                          <tr key={m.material_item_id} className={isShort ? 'bg-rose-50/40' : ''}>
                            <td className="py-2.5 px-3 font-medium text-slate-800">
                              {m.item_name}
                              <span className="block text-[10px] text-slate-400">{m.sku}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600">{m.standard_quantity} {m.uom_id}</td>
                            <td className="py-2.5 px-3 text-right font-semibold text-slate-900">{m.total_required_quantity}</td>
                            <td className="py-2.5 px-3 text-right font-medium text-emerald-600">{m.available_stock}</td>
                            <td className="py-2.5 px-3 text-right">
                              {isShort ? (
                                <span className="font-bold text-rose-600">{m.shortage_quantity}</span>
                              ) : (
                                <span className="text-slate-400">0</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isShort ? (
                                <Badge variant="danger">Shortage</Badge>
                              ) : (
                                <Badge variant="success">Sufficient</Badge>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isShort && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  loading={procuringMaterialId === m.material_item_id}
                                  onClick={() => handleRaiseProcurement(m)}
                                  className="text-xs bg-rose-100 hover:bg-rose-200 text-rose-800 border-none"
                                >
                                  Raise PR
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 p-3 rounded-lg border flex items-center justify-between text-xs font-medium">
                  {prodReqDetails.allMaterialsAvailable ? (
                    <div className="flex items-center gap-2 text-emerald-700">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span>All required raw materials are currently available in store! Ready to schedule production run.</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>Raw material shortages detected. Raise Procurement Requirements (PR) or purchase bills before issuing materials.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
                No active BOM found for this finished good. Please create and activate a BOM in Master Data before initiating production.
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t border-slate-200">
              <Button variant="outline" onClick={() => setProdReqModalOpen(false)}>
                Close
              </Button>

              {canManageProduction && prodReqDetails.bom && prodReqDetails.requirement.status !== 'fulfilled' && (
                <Button
                  variant="primary"
                  icon={Factory}
                  onClick={handleInitiateProduction}
                  loading={initiatingRun}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Initiate Production Run ({prodReqDetails.batchesNeeded} Batches)
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
