import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { FileSpreadsheet, Eye, Plus, ChevronRight } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const BomsPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [boms, setBoms] = useState([]);
  const [selectedBom, setSelectedBom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewModalOpen, setViewModalOpen] = useState(false);

  const fetchBoms = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/boms');
      if (res.success && res.data) {
        setBoms(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch BOMs');
    } finally {
      setLoading(false);
    }
  };

  const handleViewBom = async (id) => {
    try {
      const res = await api.get(`/boms/${id}`);
      if (res.success && res.data) {
        setSelectedBom(res.data);
        setViewModalOpen(true);
      }
    } catch (err) {
      alert(`Failed to load BOM: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchBoms();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bill of Materials (BOM)</h1>
          <p className="text-xs text-slate-500 mt-1">
            Standard manufacturing recipes, ingredient ratios, and packaging specifications
          </p>
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Loading Bill of Materials..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : boms.length === 0 ? (
          <EmptyState message="No BOM records found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">BOM Code</th>
                  <th className="py-3 px-4">Finished Good Item</th>
                  <th className="py-3 px-4">Version</th>
                  <th className="py-3 px-4 text-right">Standard Batch Output</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {boms.map((bom) => (
                  <tr key={bom.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">{bom.bom_code}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {bom.item_name || bom.finished_good_name}
                      <span className="text-[11px] text-slate-400 block font-mono">
                        {bom.item_sku || bom.finished_good_sku}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono">v{bom.version}</td>
                    <td className="py-3 px-4 text-right font-medium">
                      {parseFloat(bom.output_quantity || 1).toLocaleString('en-IN')}{' '}
                      <span className="text-slate-400">{bom.output_uom_name || 'Units'}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={bom.is_active ? 'success' : 'default'}>
                        {bom.is_active ? 'Active' : 'Archived'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        icon={Eye}
                        onClick={() => handleViewBom(bom.id)}
                      >
                        Inspect Recipe
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* BOM Details Modal */}
      <Modal
        isOpen={viewModalOpen}
        onClose={() => setViewModalOpen(false)}
        title={`BOM Specification — ${selectedBom?.bom_code} (v${selectedBom?.version})`}
        maxWidth="max-w-3xl"
      >
        {selectedBom && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Finished Product</span>
                <span className="font-semibold text-slate-900">{selectedBom.item_name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Batch Size</span>
                <span className="font-semibold text-slate-900">{selectedBom.output_quantity} Units</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Status</span>
                <Badge variant={selectedBom.is_active ? 'success' : 'default'}>
                  {selectedBom.is_active ? 'Active Standard' : 'Archived'}
                </Badge>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Components Count</span>
                <span className="font-semibold text-slate-900">{selectedBom.items?.length || 0} Ingredients</span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] mb-2">
                Required Recipe Components & Raw Materials
              </h4>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Item / Material</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3 text-right">Standard Quantity</th>
                      <th className="py-2.5 px-3 text-right">Scrap Allowance (%)</th>
                      <th className="py-2.5 px-3">UOM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedBom.items?.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {item.item_name}
                          <span className="text-[10px] text-slate-400 block font-mono">{item.item_sku}</span>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={item.item_type === 'packaging' ? 'warning' : 'primary'}>
                            {item.item_type || 'raw_material'}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold">
                          {parseFloat(item.quantity_required).toFixed(4)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {parseFloat(item.scrap_factor_pct || 0)}%
                        </td>
                        <td className="py-2 px-3">{item.uom_name || 'kg'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <Button variant="secondary" onClick={() => setViewModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
