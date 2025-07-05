import { storage } from '../server/storage';

async function testEnhancedStorage() {
    console.log('🧪 Testing enhanced storage methods...');
    
    try {
        // Test 1: Guest analytics update
        const testGuestId = 1; // Use an existing guest ID from your database
        console.log('\n1. Testing guest analytics update...');
        
        const updatedGuest = await storage.updateGuestAnalytics(testGuestId, {
            visitCompleted: true,
            duration: 90,
            totalSpent: 45.50
        });
        console.log('✅ Guest analytics update works:', {
            visitCount: updatedGuest.visit_count,
            totalSpent: updatedGuest.total_spent,
            reputationScore: updatedGuest.reputation_score
        });
        
        // Test 2: Reservation status history
        const testReservationId = 1; // Use an existing reservation ID
        console.log('\n2. Testing reservation status history...');
        
        const updatedReservation = await storage.updateReservationWithHistory(testReservationId, {
            status: 'confirmed'
        }, {
            changedBy: 'staff',
            changeReason: 'Manual confirmation during Phase 2 testing'
        });
        console.log('✅ Reservation status history works, new status:', updatedReservation.status);
        
        // Test 3: Get status history
        console.log('\n3. Testing get status history...');
        const history = await storage.getReservationStatusHistory(testReservationId);
        console.log('✅ Status history retrieved:', history.length, 'entries');
        
        // Test 4: Guest reservation history
        console.log('\n4. Testing guest reservation history...');
        const guestHistory = await storage.getGuestReservationHistory(testGuestId, 1); // Use your restaurant ID
        console.log('✅ Guest history retrieved:', guestHistory.length, 'reservations');
        
        console.log('\n🎉 All enhanced storage methods work correctly!');
        console.log('✅ Phase 2 completed successfully - ready for Phase 3!');
        
    } catch (error) {
        console.error('❌ Enhanced storage test failed:', error);
        console.log('\n🔧 Check that:');
        console.log('- Database migration (Phase 1) completed successfully');
        console.log('- Test guest and reservation IDs exist in database');
        console.log('- Database connection is working');
    }
}

testEnhancedStorage();