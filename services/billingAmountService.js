const premiumPlan = require('../../admin/models/premium_plan');

async function calculateBillingAmount(vendor, plan, branchesCount) {
  var branches = branchesCount != null ? branchesCount : (vendor.total_branches_created || 0);
  var planDoc = plan;
  if (!planDoc && vendor.premium_plan_id) {
    planDoc = await premiumPlan.findById(vendor.premium_plan_id).lean();
  }
  if (!planDoc) {
    return { amountInr: 0, planPrice: 0, extraBranchFee: 0, discountAmount: 0, branchesCount: branches };
  }

  var planPrice = Number(planDoc.price) || 0;
  var freeBranches = Number(planDoc.free_branches) || 0;
  var extraBranchFee = Number(planDoc.extra_branch_fee) || 0;
  var chargeableBranches = Math.max(0, branches - freeBranches);
  var extraAmount = chargeableBranches * extraBranchFee;
  var subtotal = planPrice + extraAmount;

  var discountAmount = 0;
  var isDiscounted = vendor.premium_plan_is_discounted === true;
  var discountEnd = vendor.premium_plan_discount_end_date ? new Date(vendor.premium_plan_discount_end_date) : null;
  var now = new Date();
  if (isDiscounted && (!discountEnd || discountEnd >= now)) {
    var type = vendor.premium_plan_discount_type;
    var value = Number(vendor.premium_plan_discount_value) || 0;
    if (type === 'percentage') {
      discountAmount = Math.round((subtotal * value) / 100);
    } else if (type === 'value') {
      discountAmount = Math.min(value, subtotal);
    }
  }
  var amountInr = Math.max(0, Math.round(subtotal - discountAmount));

  return {
    amountInr: amountInr,
    planPrice: planPrice,
    extraBranchFee: chargeableBranches * extraBranchFee,
    discountAmount: discountAmount,
    branchesCount: branches
  };
}

module.exports = {
  calculateBillingAmount: calculateBillingAmount
};
